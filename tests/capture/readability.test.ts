import { describe, expect, it } from 'vitest'
import { readableRecognition, unreadableImageMessage } from '../../src/capture/readability'

const words = (...confidences: (number | null)[]) => confidences.map(confidence => ({ confidence }))

describe('image readability gate', () => {
  it('accepts confident printed text', () => {
    expect(readableRecognition('Meeting notes for 12 March\nBudget approved', words(0.95, 0.9, 0.88, 0.97))).toBe(true)
  })

  it('accepts Arabic text when the recognizer is confident', () => {
    expect(readableRecognition('اللهم في حسن تدبيرك ما يغني عن الحيل', words(0.8, 0.82, 0.79))).toBe(true)
  })

  it('rejects low-confidence output even when it looks like words', () => {
    expect(readableRecognition('npm audit fix command line', words(0.3, 0.2, 0.41, 0.35))).toBe(false)
  })

  it('rejects symbol soup regardless of confidence', () => {
    expect(readableRecognition('~\\|/<>{}[]#%^*()_+=~~||//<>', words(0.9, 0.9))).toBe(false)
  })

  it('falls back to the character ratio when confidences are missing', () => {
    expect(readableRecognition('Readable sentence here', words(null, null))).toBe(true)
    expect(readableRecognition('@#$%^&*()_+', words(null))).toBe(false)
    expect(readableRecognition('', [])).toBe(false)
  })

  it('names the limitation honestly', () => {
    expect(unreadableImageMessage).toMatch(/handwriting/i)
  })
})
