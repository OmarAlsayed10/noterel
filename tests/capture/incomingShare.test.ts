import { describe, expect, it } from 'vitest'
import { normalizeIncomingShare } from '../../src/capture/incomingShare'

describe('incoming text shares', () => {
  it('normalizes exact HTTPS links without credentials', () => {
    expect(normalizeIncomingShare({ text: ' https://example.test/note ' })).toEqual({ kind: 'url', text: 'https://example.test/note', title: null, captureMode: 'reference' })
    expect(() => normalizeIncomingShare({ text: '', webUrl: 'https://owner:secret@example.test/' })).toThrow('empty')
  })

  it('uses the platform URL when a link share also contains display text', () => {
    expect(normalizeIncomingShare({ text: 'Read https://example.test later', webUrl: 'https://example.test', title: ' Reading ' })).toEqual({ kind: 'url', text: 'https://example.test/', title: 'Reading', captureMode: 'reference' })
  })

  it('keeps an explicitly selected TikTok caption language with the saved link', () => {
    expect(normalizeIncomingShare({ text: 'https://vt.tiktok.com/ZSqcALa3n/', captionLanguage: 'ara-SA' })).toEqual({ kind: 'url', text: 'https://vt.tiktok.com/ZSqcALa3n/', title: null, captionLanguage: 'ara-SA', captureMode: 'extract' })
    expect(() => normalizeIncomingShare({ text: 'https://example.com/', captionLanguage: 'ara-SA' })).toThrow('TikTok caption language')
  })

  it('rejects files, empty input, and oversized UTF-8 fields', () => {
    expect(() => normalizeIncomingShare({ files: [{}], text: 'caption' })).toThrow('Only shared text')
    expect(() => normalizeIncomingShare({ text: '   ' })).toThrow('empty')
    expect(() => normalizeIncomingShare({ text: 'é'.repeat(524_289) })).toThrow('1 MiB')
    expect(() => normalizeIncomingShare({ text: 'valid', title: 'é'.repeat(257) })).toThrow('512-byte')
  })
})
