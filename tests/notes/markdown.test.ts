import { describe, expect, it } from 'vitest'
import { applyMarkdownFormat, type MarkdownFormat } from '../../src/notes/markdown'

describe('mobile note formatting', () => {
  it.each([
    ['bold', '**selected**'],
    ['italic', '*selected*'],
    ['strike', '~~selected~~'],
    ['inlineCode', '`selected`'],
    ['highlight', '==selected=='],
    ['codeBlock', '```\nselected\n```'],
    ['link', '[selected](https://)']
  ] satisfies readonly [MarkdownFormat, string][])('wraps selected text as %s', (format, expected) => {
    expect(applyMarkdownFormat('selected', { start: 0, end: 8 }, format).text).toBe(expected)
  })

  it('formats every selected line as an ordered list', () => {
    expect(applyMarkdownFormat('before\none\ntwo\nafter', { start: 7, end: 14 }, 'numbered').text).toBe('before\n1. one\n2. two\nafter')
  })
})
