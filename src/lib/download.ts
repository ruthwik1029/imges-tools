export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function downloadZip(files: Array<{ blob: Blob; name: string }>, archiveName: string) {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  files.forEach(({ blob, name }) => zip.file(name, blob))
  const archive = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  downloadBlob(archive, archiveName)
}
