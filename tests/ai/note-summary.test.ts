import { describe, expect, it } from 'vitest'
import { summaryNoteTitle, summarySourceText } from '../../src/ai/noteSummary'

describe('note summary context', () => {
  it('keeps short notes complete', () => {
    expect(summarySourceText('Complete note')).toEqual({ text: 'Complete note', truncated: false })
  })

  it('bounds generated titles to the capture limit', () => {
    const title = summaryNoteTitle('Summary:', 'م'.repeat(300))
    expect(new TextEncoder().encode(title).byteLength).toBeLessThanOrEqual(512)
    expect(title).not.toContain('�')
  })

  it.each(['قراءة'.repeat(10_000), '📚'.repeat(20_000)])('bounds long Unicode notes without breaking their text', note => {
    const bounded = summarySourceText(note)
    expect(new TextEncoder().encode(bounded.text).byteLength).toBeLessThanOrEqual(40 * 1024)
    expect(bounded.text.at(-1)).not.toMatch(/[\uD800-\uDBFF]/u)
    expect(bounded.truncated).toBe(true)
  })
})
