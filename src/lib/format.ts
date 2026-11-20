export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exponent
  const digits = exponent === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2
  return `${value.toFixed(digits)} ${units[exponent]}`
}

export function extensionForMime(mime: string): string {
  return ({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/avif': 'avif',
  } as Record<string, string>)[mime] ?? 'bin'
}

export function outputName(name: string, mime: string, suffix = 'optimized'): string {
  const stem = name.replace(/\.[^.]+$/, '')
  return `${stem}-${suffix}.${extensionForMime(mime)}`
}

export function savingsPercent(before: number, after: number): number {
  if (before <= 0) return 0
  return Math.max(0, Math.round((1 - after / before) * 100))
}

export function formatLabel(mime: string): string {
  return mime.split('/')[1]?.toUpperCase().replace('JPEG', 'JPG') ?? 'UNKNOWN'
}
