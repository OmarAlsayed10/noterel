const ignoredTerms = new Set(['http', 'https', 'www', 'com', 'org', 'net', 'test', 'example', 'the', 'and', 'for', 'from', 'with', 'this', 'that', 'your'])

const terms = (text: string): ReadonlySet<string> => new Set((text.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(term => !ignoredTerms.has(term)).slice(0, 4096))

export const relationshipScore = (first: string, second: string): number => {
  const left = terms(first)
  const right = terms(second)
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const term of left) if (right.has(term)) shared += 1
  return shared / Math.sqrt(left.size * right.size)
}
