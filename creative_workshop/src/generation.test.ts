import { describe, expect, it } from 'vitest'
import { resolveGenerationMode } from './generation'

describe('generation mode resolution', () => {
  it('uses the selected RunningHub workflow capability', () => {
    expect(resolveGenerationMode('runninghub', false, 'image-to-video')).toBe('image-to-video')
  })

  it('infers NanoBanana mode from the reference image', () => {
    expect(resolveGenerationMode('gemini', false)).toBe('text-to-image')
    expect(resolveGenerationMode('gemini', true)).toBe('image-to-image')
  })

  it('keeps the historical mode during retry', () => {
    expect(resolveGenerationMode('gemini', true, undefined, 'text-to-image')).toBe('text-to-image')
  })
})
