import { describe, expect, it } from 'vitest'
import { rankLocalContextCandidates } from '../../src/ai/localContextRanking'

const candidates = [
  { id: 'recent', title: 'Shopping', preview: 'Coffee and fruit', updatedAtMs: 30 },
  { id: 'relevant', title: 'Battery schedule', preview: 'Inspect the terminals in October', updatedAtMs: 10 },
  { id: 'older', title: 'Travel', preview: 'Train departure', updatedAtMs: 20 }
]

describe('automatic phone context retrieval', () => {
  it('prefers wording relevant to the question over recency', () => {
    expect(rankLocalContextCandidates('When is the battery inspection?', candidates).map(candidate => candidate.id)).toEqual(['relevant'])
  })

  it('falls back to recent notes when the question has no wording match', () => {
    expect(rankLocalContextCandidates('unrelated phrase', candidates).map(candidate => candidate.id)).toEqual(['recent', 'older', 'relevant'])
  })
})
