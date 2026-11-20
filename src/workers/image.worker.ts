/// <reference lib="webworker" />

import type { CompressionSettings } from '../types'

declare const self: DedicatedWorkerGlobalScope

interface CompressMessage {
  type: 'compress'
  buffer: ArrayBuffer
  mime: string
  settings: CompressionSettings
}

function postProgress(value: number) {
  self.postMessage({ type: 'progress', value })
}

function outputDimensions(width: number, height: number, settings: CompressionSettings) {
  if (!settings.resize) return { width, height }
  const scale = Math.min(
    1,
    settings.maxWidth ? settings.maxWidth / width : 1,
    settings.maxHeight ? settings.maxHeight / height : 1,
  )
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

async function similarityScore(original: ImageBitmap, encoded: Blob): Promise<number> {
  const decoded = await createImageBitmap(encoded)
  const width = Math.min(160, original.width)
  const height = Math.max(1, Math.round((width / original.width) * original.height))
  const sourceCanvas = new OffscreenCanvas(width, height)
  const resultCanvas = new OffscreenCanvas(width, height)
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true })
  const resultContext = resultCanvas.getContext('2d', { willReadFrequently: true })
  if (!sourceContext || !resultContext) {
    decoded.close()
    return 1
  }
  sourceContext.drawImage(original, 0, 0, width, height)
  resultContext.drawImage(decoded, 0, 0, width, height)
  const source = sourceContext.getImageData(0, 0, width, height).data
  const result = resultContext.getImageData(0, 0, width, height).data
  let error = 0
  for (let index = 0; index < source.length; index += 4) {
    const sourceLuma = 0.2126 * source[index] + 0.7152 * source[index + 1] + 0.0722 * source[index + 2]
    const resultLuma = 0.2126 * result[index] + 0.7152 * result[index + 1] + 0.0722 * result[index + 2]
    error += Math.abs(sourceLuma - resultLuma) / 255
  }
  decoded.close()
  return Math.max(0, 1 - error / (source.length / 4))
}

async function encode(canvas: OffscreenCanvas, format: string, quality: number): Promise<Blob> {
  const requested = format as 'image/jpeg' | 'image/png' | 'image/webp'
  const blob = await canvas.convertToBlob({ type: requested, quality })
  if (blob.type !== requested && requested !== 'image/png') {
    throw new Error(`${requested.split('/')[1].toUpperCase()} encoding is not supported by this browser.`)
  }
  return blob
}

async function compress(message: CompressMessage) {
  postProgress(5)
  const sourceBlob = new Blob([message.buffer], { type: message.mime })
  const bitmap = await createImageBitmap(sourceBlob, { imageOrientation: 'from-image' })
  const dimensions = outputDimensions(bitmap.width, bitmap.height, message.settings)
  const canvas = new OffscreenCanvas(dimensions.width, dimensions.height)
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) throw new Error('Offscreen canvas is unavailable in this browser.')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height)

  const isLossless = message.settings.format === 'image/png'
  const target = message.settings.targetBytes
  const minimumSimilarity = message.settings.preserveQuality ? 0.965 : 0.93
  let quality = isLossless ? 1 : message.settings.quality
  let output = await encode(canvas, message.settings.format, quality)
  let iterations = 1
  let similarity = await similarityScore(bitmap, output)
  if (isLossless && !message.settings.resize && message.settings.format === message.mime && output.size >= sourceBlob.size) {
    output = sourceBlob
    similarity = 1
  }
  let targetReached = !target || output.size <= target
  postProgress(32)

  if (target && !isLossless && output.size > target) {
    let low = 0.24
    let high = Math.min(0.99, quality)
    let best = { blob: output, quality, similarity }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      quality = (low + high) / 2
      const candidate = await encode(canvas, message.settings.format, quality)
      const candidateSimilarity = await similarityScore(bitmap, candidate)
      iterations += 1
      postProgress(35 + Math.round(((attempt + 1) / 8) * 55))
      const acceptable = candidateSimilarity >= minimumSimilarity
      if (acceptable && (candidate.size < best.blob.size || best.similarity < minimumSimilarity)) {
        best = { blob: candidate, quality, similarity: candidateSimilarity }
      }
      if (candidate.size > target) high = quality
      else if (!acceptable) low = quality
      else {
        best = { blob: candidate, quality, similarity: candidateSimilarity }
        low = quality
      }
    }
    output = best.blob
    quality = best.quality
    similarity = best.similarity
    targetReached = output.size <= target && similarity >= minimumSimilarity
  }

  bitmap.close()
  const warning = target && !targetReached
    ? `The closest quality-safe result is ${Math.round(output.size / 1024)} KB. A smaller file would cross the selected visual-quality boundary.`
    : similarity < 0.965
      ? 'Fine detail may show visible compression. Inspect the comparison before downloading.'
      : undefined
  postProgress(100)
  self.postMessage({
    type: 'result',
    result: {
      blob: output,
      width: dimensions.width,
      height: dimensions.height,
      quality,
      similarity,
      targetReached,
      iterations,
      warning,
    },
  })
}

self.onmessage = async (event: MessageEvent<CompressMessage>) => {
  if (event.data.type !== 'compress') return
  try {
    await compress(event.data)
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'Image processing failed.' })
  }
}

export {}
