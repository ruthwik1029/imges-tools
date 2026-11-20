export type PdfPageSize = 'a4' | 'a3' | 'letter' | 'original'
export type PdfFit = 'contain' | 'cover'

export interface ImagesToPdfOptions {
  pageSize: PdfPageSize
  orientation: 'portrait' | 'landscape'
  margin: number
  fit: PdfFit
}

async function imageAsPng(file: File): Promise<{ bytes: ArrayBuffer; width: number; height: number }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable for PDF conversion.')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error(`Could not prepare ${file.name} for PDF conversion.`)
  return { bytes: await blob.arrayBuffer(), width: canvas.width, height: canvas.height }
}

function resolvePageSize(option: PdfPageSize, imageWidth: number, imageHeight: number, pageSizes: Record<string, readonly [number, number]>): [number, number] {
  if (option === 'original') {
    const scale = 72 / 96
    return [imageWidth * scale, imageHeight * scale]
  }
  if (option === 'a3') return [...pageSizes.A3]
  if (option === 'letter') return [...pageSizes.Letter]
  return [...pageSizes.A4]
}

export async function imagesToPdf(files: File[], options: ImagesToPdfOptions): Promise<Blob> {
  if (!files.length) throw new Error('Add at least one image to create a PDF.')
  const { PDFDocument, PageSizes } = await import('pdf-lib')
  const document = await PDFDocument.create()
  document.setTitle('ISR HR image collection')
  document.setProducer('ISR HR Smart Compressor')

  for (const file of files) {
    const prepared = await imageAsPng(file)
    const embedded = await document.embedPng(prepared.bytes)
    let [pageWidth, pageHeight] = resolvePageSize(options.pageSize, prepared.width, prepared.height, PageSizes)
    if (options.orientation === 'landscape' && pageHeight > pageWidth) [pageWidth, pageHeight] = [pageHeight, pageWidth]
    if (options.orientation === 'portrait' && pageWidth > pageHeight) [pageWidth, pageHeight] = [pageHeight, pageWidth]
    const page = document.addPage([pageWidth, pageHeight])
    const usableWidth = Math.max(1, pageWidth - options.margin * 2)
    const usableHeight = Math.max(1, pageHeight - options.margin * 2)
    const scale = options.fit === 'cover'
      ? Math.max(usableWidth / prepared.width, usableHeight / prepared.height)
      : Math.min(usableWidth / prepared.width, usableHeight / prepared.height)
    const drawWidth = prepared.width * scale
    const drawHeight = prepared.height * scale
    page.drawImage(embedded, {
      x: (pageWidth - drawWidth) / 2,
      y: (pageHeight - drawHeight) / 2,
      width: drawWidth,
      height: drawHeight,
    })
  }
  const bytes = await document.save()
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return new Blob([buffer], { type: 'application/pdf' })
}

export interface PdfRenderOptions {
  format: 'png' | 'jpeg'
  scale: number
  pages?: number[]
  onProgress?: (current: number, total: number) => void
}

export async function pdfToImages(file: File, options: PdfRenderOptions): Promise<Array<{ blob: Blob; name: string; page: number }>> {
  const [pdfjs, workerModule] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default
  const data = await file.arrayBuffer()
  const task = pdfjs.getDocument({ data })
  const pdfDocument = await task.promise
  const selected = options.pages?.length
    ? options.pages.filter((page) => page >= 1 && page <= pdfDocument.numPages)
    : Array.from({ length: pdfDocument.numPages }, (_, index) => index + 1)
  if (!selected.length) throw new Error('No valid PDF pages were selected.')
  const stem = file.name.replace(/\.pdf$/i, '')
  const results: Array<{ blob: Blob; name: string; page: number }> = []
  for (let index = 0; index < selected.length; index += 1) {
    const pageNumber = selected[index]
    const page = await pdfDocument.getPage(pageNumber)
    const viewport = page.getViewport({ scale: options.scale, rotation: page.rotate })
    const canvas = window.document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const context = canvas.getContext('2d', { alpha: options.format === 'png' })
    if (!context) throw new Error(`Could not render page ${pageNumber}.`)
    await page.render({ canvas, canvasContext: context, viewport }).promise
    const mime = options.format === 'png' ? 'image/png' : 'image/jpeg'
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.92))
    if (!blob) throw new Error(`Could not encode page ${pageNumber}.`)
    results.push({ blob, page: pageNumber, name: `${stem}-page-${pageNumber}.${options.format === 'png' ? 'png' : 'jpg'}` })
    page.cleanup()
    options.onProgress?.(index + 1, selected.length)
  }
  await task.destroy()
  return results
}
