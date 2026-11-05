export function originalYouTubeCaption(tracks: readonly Record<string, unknown>[]): Record<string, unknown> | undefined {
  const originals = tracks.filter(track => typeof track.languageCode === 'string' && !(typeof track.baseUrl === 'string' && /[?&]tlang=/u.test(track.baseUrl)))
  const speech = originals.filter(track => track.kind === 'asr')
  const speechLanguages = new Set(speech.map(track => track.languageCode))
  if (speechLanguages.size > 1) return undefined
  const language = speech[0]?.languageCode
  const candidates = language ? originals.filter(track => track.languageCode === language) : originals
  if (new Set(candidates.map(track => track.languageCode)).size > 1) return undefined
  return candidates.find(track => track.kind !== 'asr') ?? candidates[0]
}
