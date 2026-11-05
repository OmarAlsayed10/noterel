interface LocalContextCandidate {
  readonly id: string
  readonly title: string
  readonly preview: string
  readonly updatedAtMs: number
}

const evidenceMaximumBytes = 4 * 1024

const ignoredTerms = new Set(['the', 'and', 'for', 'from', 'with', 'this', 'that', 'what', 'when', 'where', 'which', 'does', 'about', 'your', 'notes', 'say', 'how', 'why', 'are', 'is', 'do', 'my', 'me', 'of', 'to', 'in', 'on', 'an'])

const queryTerms = (query: string): readonly string[] => [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].filter(term => !ignoredTerms.has(term)).slice(0, 16)

const relevance = (candidate: LocalContextCandidate, terms: readonly string[]): number => {
  const title = candidate.title.toLocaleLowerCase()
  const preview = candidate.preview.toLocaleLowerCase()
  return terms.reduce((score, term) => score + (title.includes(term) ? 4 : 0) + (preview.includes(term) ? 1 : 0), 0)
}

export function rankLocalContextCandidates(query: string, candidates: readonly LocalContextCandidate[]): readonly LocalContextCandidate[] {
  const terms = queryTerms(query)
  const ranked = candidates
    .map(candidate => ({ candidate, score: relevance(candidate, terms) }))
    .sort((left, right) => right.score - left.score || right.candidate.updatedAtMs - left.candidate.updatedAtMs || left.candidate.id.localeCompare(right.candidate.id))
  const matching = ranked.filter(candidate => candidate.score > 0)
  return (matching.length > 0 ? matching : ranked).slice(0, 8).map(candidate => candidate.candidate)
}

export function boundedLocalEvidence(text: string, query: string): string {
  const lowercase = text.toLocaleLowerCase()
  const firstMatch = queryTerms(query).map(term => lowercase.indexOf(term)).filter(index => index >= 0).sort((left, right) => left - right)[0] ?? 0
  const candidate = text.slice(Math.max(0, firstMatch - 600))
  if (new TextEncoder().encode(candidate).byteLength <= evidenceMaximumBytes) return candidate
  let lower = 0
  let upper = Math.min(candidate.length, evidenceMaximumBytes)
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2)
    if (new TextEncoder().encode(candidate.slice(0, middle)).byteLength <= evidenceMaximumBytes) lower = middle
    else upper = middle - 1
  }
  return candidate.slice(0, lower)
}
