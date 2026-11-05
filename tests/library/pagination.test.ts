import { describe, expect, it } from 'vitest'
import { requestedPageIndex } from '../../src/library/pagination'

describe('library page navigation', () => {
  it.each([
    ['1', 200, 0],
    ['200', 200, 199],
    ['0', 200, null],
    ['201', 200, null],
    ['', 200, null],
    ['1.5', 200, null],
    ['9007199254740992', 9007199254740991, null]
  ])('validates direct page entry %s within %s pages', (value, totalPages, expected) => {
    expect(requestedPageIndex(value, totalPages)).toBe(expected)
  })
})
