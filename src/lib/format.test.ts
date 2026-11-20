import { describe, expect, it } from 'vitest'
import { extensionForMime, formatBytes, outputName, savingsPercent } from './format'

describe('format helpers', () => {
  it('formats byte sizes and savings from actual byte counts', () => {
    expect(formatBytes(1024)).toBe('1.00 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.00 MB')
    expect(savingsPercent(1000, 250)).toBe(75)
  })

  it('creates meaningful output names', () => {
    expect(extensionForMime('image/jpeg')).toBe('jpg')
    expect(outputName('portrait.final.png', 'image/webp')).toBe('portrait.final-optimized.webp')
  })
})
