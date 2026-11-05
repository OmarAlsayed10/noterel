const ignoredCharacters = 'ًٌٍَُِّْٰـ'
const foldedCharacters: Readonly<Record<string, string>> = { أ: 'ا', إ: 'ا', آ: 'ا', ٱ: 'ا', ى: 'ي' }

export function normalizedSearchText(text: string): string {
  return text.toLowerCase().replace(/[ًٌٍَُِّْٰـ]/gu, '').replace(/[أإآٱى]/gu, character => foldedCharacters[character])
}

export function searchTerms(query: string): readonly string[] {
  const terms = [...new Set(normalizedSearchText(query).trim().split(/\s+/u).filter(Boolean))]
  if (terms.length > 32) throw new RangeError('Use no more than 32 search words')
  return terms
}

export function normalizedSearchSql(expression: string): string {
  let normalized = `lower(${expression})`
  for (const character of ignoredCharacters) normalized = `replace(${normalized},'${character}','')`
  for (const [character, folded] of Object.entries(foldedCharacters)) normalized = `replace(${normalized},'${character}','${folded}')`
  return normalized
}

export function searchRanges(text: string, query: string): readonly { start: number; end: number }[] {
  const normalized = normalizedSearchText(text)
  const matches = searchTerms(query).flatMap(term => {
    const ranges: { start: number; end: number }[] = []
    for (let offset = normalized.indexOf(term); offset >= 0; offset = normalized.indexOf(term, offset + term.length)) ranges.push({ start: offset, end: offset + term.length })
    return ranges
  }).sort((left, right) => left.start - right.start)
  const merged = matches.reduce<{ start: number; end: number }[]>((ranges, match) => {
    const last = ranges[ranges.length - 1]
    if (last && match.start <= last.end) last.end = Math.max(last.end, match.end)
    else ranges.push({ ...match })
    return ranges
  }, [])
  return originalRanges(text, merged)
}

export function phraseSearchRanges(text: string, phrase: string): readonly { start: number; end: number }[] {
  const needle = normalizedSearchText(phrase)
  if (!needle) return []
  const normalized = normalizedSearchText(text)
  const matches: { start: number; end: number }[] = []
  for (let offset = normalized.indexOf(needle); offset >= 0; offset = normalized.indexOf(needle, offset + needle.length)) matches.push({ start: offset, end: offset + needle.length })
  return originalRanges(text, matches)
}

function originalRanges(text: string, normalizedRanges: readonly { start: number; end: number }[]) {
  if (normalizedRanges.length === 0) return []
  const ranges = normalizedRanges.map(() => ({ start: 0, end: 0 }))
  let sourceOffset = 0
  let normalizedOffset = 0
  let index = 0
  for (const character of text) {
    const length = ignoredCharacters.includes(character) ? 0 : (foldedCharacters[character] ?? character.toLowerCase()).length
    if (!length && index > 0 && normalizedRanges[index - 1].end === normalizedOffset) ranges[index - 1].end = sourceOffset + character.length
    while (length && index < normalizedRanges.length && normalizedRanges[index].start < normalizedOffset + length) {
      const current = normalizedRanges[index]
      if (current.start >= normalizedOffset && current.start < normalizedOffset + length) ranges[index].start = sourceOffset
      if (current.end > normalizedOffset && current.end <= normalizedOffset + length) { ranges[index].end = sourceOffset + character.length; index += 1 }
      else break
    }
    normalizedOffset += length
    sourceOffset += character.length
  }
  return ranges
}
