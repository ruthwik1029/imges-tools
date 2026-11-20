export type OutputFormat = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif'
export type JobStatus = 'ready' | 'processing' | 'complete' | 'error' | 'cancelled'

export interface ImageAsset {
  id: string
  file: File
  url: string
  name: string
  size: number
  width: number
  height: number
  mime: string
  hasAlpha: boolean
  kind: 'photo' | 'graphic'
  status: JobStatus
  progress: number
  error?: string
  result?: CompressionResult
}

export interface CompressionSettings {
  format: OutputFormat
  quality: number
  targetBytes?: number
  resize: boolean
  maxWidth?: number
  maxHeight?: number
  preserveQuality: boolean
}

export interface CompressionResult {
  blob: Blob
  url: string
  width: number
  height: number
  quality: number
  similarity: number
  targetReached: boolean
  iterations: number
  warning?: string
}

export interface WorkerResult {
  blob: Blob
  width: number
  height: number
  quality: number
  similarity: number
  targetReached: boolean
  iterations: number
  warning?: string
}

export interface HistoryEntry {
  id: string
  name: string
  before: number
  after: number
  format: string
  completedAt: number
}
