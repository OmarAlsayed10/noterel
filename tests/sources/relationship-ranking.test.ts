import { describe, expect, it } from 'vitest'
import { relationshipScore } from '../../src/sources/relationshipRanking'

describe('local relationship ranking', () => {
  it('links memories with substantial wording overlap', () => {
    expect(relationshipScore('private graph memory retrieval', 'graph memory citations')).toBeGreaterThan(0.4)
    expect(relationshipScore('private graph memory retrieval', 'garden recipe tomatoes')).toBe(0)
  })

  it('handles empty and repeated terms deterministically', () => {
    expect(relationshipScore('', 'memory')).toBe(0)
    expect(relationshipScore('memory memory memory', 'memory')).toBe(1)
    expect(relationshipScore('https://first.example.com', 'https://second.example.com')).toBe(0)
  })
})
