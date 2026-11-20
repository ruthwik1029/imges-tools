import type { CompressionSettings, ImageAsset, WorkerResult } from '../types'

const ACCEPTED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif',
])

const MAX_FILE_BYTES = 80 * 1024 * 1024
const MAX_PIXELS = 100_000_000

function signatureMatches(buffer: ArrayBuffer, mime: string): boolean {
  const bytes = new Uint8Array(buffer)
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start, end))
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (mime === 'image/png') return ascii(1, 4) === 'PNG'
  if (mime === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
  if (mime === 'image/avif') return ascii(4, 12).includes('ftyp') && ascii(8, 32).includes('avif')
  if (mime === 'image/heic' || mime === 'image/heif') return ascii(4, 12).includes('ftyp')
  return false
}

async function analyzeBitmap(bitmap: ImageBitmap): Promise<{ hasAlpha: boolean; kind: 'photo' | 'graphic' }> {
  const sampleWidth = Math.min(160, bitmap.width)
  const sampleHeight = Math.max(1, Math.round((sampleWidth / bitmap.width) * bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = sampleWidth
  canvas.height = sampleHeight
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return { hasAlpha: false, kind: 'photo' }
  context.drawImage(bitmap, 0, 0, sampleWidth, sampleHeight)
  const data = context.getImageData(0, 0, sampleWidth, sampleHeight).data
  let alphaPixels = 0
  let edgeScore = 0
  let previousLuma = 0
  const colorBuckets = new Set<number>()
  for (let index = 0; index < data.length; index += 4) {
    const [red, green, blue, alpha] = [data[index], data[index + 1], data[index + 2], data[index + 3]]
    if (alpha < 250) alphaPixels += 1
    const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue
    if (index > 0) edgeScore += Math.abs(luma - previousLuma)
    previousLuma = luma
    colorBuckets.add(((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4))
  }
  const pixels = Math.max(1, data.length / 4)
  const averageEdge = edgeScore / pixels
  const colorDiversity = colorBuckets.size / Math.min(pixels, 4096)
  return {
    hasAlpha: alphaPixels > 0,
    kind: averageEdge < 31 && colorDiversity > 0.16 ? 'photo' : 'graphic',
  }
}

export async function inspectFile(file: File): Promise<ImageAsset> {
  const normalizedMime = file.type === 'image/jpg' ? 'image/jpeg' : file.type
  if (!ACCEPTED_MIMES.has(normalizedMime)) throw new Error('Unsupported file type. Choose PNG, JPG, WebP, AVIF, HEIC, or HEIF.')
  if (file.size > MAX_FILE_BYTES) throw new Error('This file exceeds the 80 MB browser processing limit.')
  const header = await file.slice(0, 64).arrayBuffer()
  if (!signatureMatches(header, normalizedMime)) throw new Error('The file signature does not match its declared image format.')

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error(normalizedMime.includes('hei')
      ? 'This browser cannot decode this HEIC/HEIF image. Convert it to PNG, JPG, or WebP first.'
      : 'The image is corrupted or cannot be decoded by this browser.')
  }
  if (bitmap.width * bitmap.height > MAX_PIXELS) {
    bitmap.close()
    throw new Error('This image exceeds the 100 megapixel safety limit.')
  }
  const analysis = await analyzeBitmap(bitmap)
  const asset: ImageAsset = {
    id: crypto.randomUUID(),
    file,
    url: URL.createObjectURL(file),
    name: file.name,
    size: file.size,
    width: bitmap.width,
    height: bitmap.height,
    mime: normalizedMime,
    hasAlpha: analysis.hasAlpha,
    kind: analysis.kind,
    status: 'ready',
    progress: 0,
  }
  bitmap.close()
  return asset
}

export function getRecommendation(asset: ImageAsset): { format: CompressionSettings['format']; message: string; lossless: boolean } {
  if (asset.hasAlpha || asset.kind === 'graphic') {
    return {
      format: 'image/webp',
      lossless: asset.hasAlpha,
      message: asset.hasAlpha
        ? 'Transparency detected. WebP can preserve alpha while usually reducing size. Use PNG when exact pixel values are required.'
        : 'This looks like a graphic or screenshot. WebP usually reduces delivery size while keeping edges crisp. Use PNG when exact pixel values are required.',
    }
  }
  return {
    format: 'image/webp',
    lossless: false,
    message: 'This looks like a photograph. WebP at high quality is likely to reduce size while preserving fine visual detail.',
  }
}

export function compressInWorker(
  asset: ImageAsset,
  settings: CompressionSettings,
  onProgress: (progress: number) => void,
): { promise: Promise<WorkerResult>; cancel: () => void } {
  const worker = new Worker(new URL('../workers/image.worker.ts', import.meta.url), { type: 'module' })
  let settled = false
  let rejectPromise: ((reason?: unknown) => void) | undefined
  const promise = new Promise<WorkerResult>(async (resolve, reject) => {
    rejectPromise = reject
    worker.onmessage = (event: MessageEvent) => {
      if (event.data.type === 'progress') onProgress(event.data.value)
      if (event.data.type === 'result') {
        settled = true
        worker.terminate()
        resolve(event.data.result as WorkerResult)
      }
      if (event.data.type === 'error') {
        settled = true
        worker.terminate()
        reject(new Error(event.data.message))
      }
    }
    worker.onerror = () => {
      settled = true
      worker.terminate()
      reject(new Error('The background image processor stopped unexpectedly.'))
    }
    try {
      const buffer = await asset.file.arrayBuffer()
      worker.postMessage({ type: 'compress', buffer, mime: asset.mime, settings }, [buffer])
    } catch (error) {
      worker.terminate()
      reject(error)
    }
  })
  return {
    promise,
    cancel: () => {
      if (!settled) {
        settled = true
        worker.terminate()
        rejectPromise?.(new DOMException('Processing cancelled.', 'AbortError'))
      }
    },
  }
}

export async function convertToPng(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable in this browser.')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('PNG encoding failed.')
  return blob
}
