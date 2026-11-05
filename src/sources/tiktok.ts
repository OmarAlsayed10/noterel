export interface ExtractedTikTokItem {
  readonly videoId: string
  readonly canonicalUrl: string
  readonly title: string
  readonly author: string
  readonly durationMs: number
  readonly captionLanguage: string | null
  readonly captionUrl: string | null
  readonly captionSource: string | null
  readonly captionLanguages: readonly string[]
  readonly imageCount: number
}

const tiktokHosts = new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vt.tiktok.com', 'vm.tiktok.com'])
const rehydrationScript = /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/iu
const apiDataScript = /<script id="api-data"[^>]*>([\s\S]*?)<\/script>/iu
const detailScopes = ['webapp.reflow.video.detail', 'webapp.video-detail'] as const

const record = (value: unknown): Readonly<Record<string, unknown>> => value && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {}
const text = (value: unknown): string => typeof value === 'string' ? value : ''

export const tiktokVideoUrl = (rawUrl: string): boolean => {
  try {
    return tiktokUrl(rawUrl) && /^\/@[^/]+\/video\/\d+/u.test(new URL(rawUrl).pathname)
  } catch {
    return false
  }
}

export const tiktokUrl = (rawUrl: string): boolean => {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:' && tiktokHosts.has(url.hostname.toLocaleLowerCase())
  } catch {
    return false
  }
}

const captionLink = (rawUrl: string): string | null => {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:' && url.hostname.toLocaleLowerCase().endsWith('.tiktok.com') && !url.username && !url.password ? url.toString() : null
  } catch {
    return null
  }
}

const validSubtitles = (subtitles: readonly unknown[]): readonly Readonly<Record<string, unknown>>[] => subtitles.map(record).filter(subtitle => text(subtitle.Format).toLowerCase() === 'webvtt' && captionLink(text(subtitle.Url)) !== null)

const chosenSubtitle = (webvtt: readonly Readonly<Record<string, unknown>>[], selectedLanguage?: string): Readonly<Record<string, unknown>> | null => {
  if (selectedLanguage) return webvtt.find(subtitle => text(subtitle.LanguageCodeName) === selectedLanguage && text(subtitle.Source).toUpperCase() !== 'MT') ?? webvtt.find(subtitle => text(subtitle.LanguageCodeName) === selectedLanguage) ?? null
  if (new Set(webvtt.filter(subtitle => text(subtitle.Source).toUpperCase() === 'ASR').map(subtitle => subtitle.LanguageCodeName)).size > 1) return null
  const speech = webvtt.find(subtitle => text(subtitle.Source).toUpperCase() === 'ASR')
  const original = speech && webvtt.find(subtitle => text(subtitle.LanguageCodeName) === text(speech.LanguageCodeName) && text(subtitle.Source).toUpperCase() !== 'ASR' && text(subtitle.Source).toUpperCase() !== 'MT')
  const untranslated = webvtt.filter(subtitle => text(subtitle.Source).toUpperCase() !== 'MT')
  if (!speech && new Set(untranslated.map(subtitle => text(subtitle.LanguageCodeName))).size > 1) return null
  return original || speech || untranslated[0] || null
}

export function extractTikTokItem(html: string, requestedUrl: string, selectedLanguage?: string): ExtractedTikTokItem | null {
  const payload = html.match(apiDataScript)?.[1] ?? html.match(rehydrationScript)?.[1]
  if (!payload) return null
  let detail: Readonly<Record<string, unknown>> | undefined
  try {
    const parsed = record(JSON.parse(payload))
    const scope = record(parsed.__DEFAULT_SCOPE__)
    detail = detailScopes.map(name => record(scope[name])).find(candidate => Object.keys(candidate).length > 0) ?? record(parsed.videoDetail)
  } catch {
    return null
  }
  if (!detail || !Object.keys(detail).length) return null
  const item = record(record(detail.itemInfo).itemStruct)
  const video = record(item.video)
  const videoId = text(item.id)
  if (!/^\d{1,32}$/u.test(videoId)) return null
  const images = record(item.imagePost).images
  const imageCount = Array.isArray(images) ? images.length : 0
  const subtitles = Array.isArray(video.subtitleInfos) ? validSubtitles(video.subtitleInfos) : []
  const captionLanguages = [...new Set(subtitles.map(subtitle => text(subtitle.LanguageCodeName)).filter(language => /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/u.test(language)))].slice(0, 12)
  const subtitle = chosenSubtitle(subtitles, selectedLanguage)
  const author = record(item.author)
  const uniqueId = text(author.uniqueId)
  const authorName = text(author.nickname).trim() || uniqueId
  const duration = Number(video.duration)
  return {
    videoId,
    canonicalUrl: /^[\w.-]{1,64}$/u.test(uniqueId) ? `https://www.tiktok.com/@${uniqueId}/${imageCount > 0 ? 'photo' : 'video'}/${videoId}` : new URL(requestedUrl).toString(),
    title: authorName ? `TikTok ${imageCount > 0 ? 'post' : 'video'} by ${authorName}` : `TikTok ${imageCount > 0 ? 'post' : 'video'} ${videoId}`,
    author: authorName,
    durationMs: Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : 0,
    captionLanguage: subtitle ? text(subtitle.LanguageCodeName) || null : null,
    captionUrl: subtitle ? captionLink(text(subtitle.Url)) : null,
    captionSource: subtitle ? text(subtitle.Source) || null : null,
    captionLanguages,
    imageCount
  }
}

export async function previewTikTokCaptions(url: string): Promise<ExtractedTikTokItem> {
  if (!tiktokUrl(url)) throw new RangeError('TikTok URL is invalid')
  const native = (await import('../../modules/kestrel-source-processing')).default
  const fetched = await native.fetchPublicSource(url)
  const video = fetched.mediaType === 'text/html' && tiktokUrl(fetched.finalUrl) ? extractTikTokItem(fetched.text, fetched.finalUrl) : null
  if (!video) throw new RangeError('TikTok did not expose video details')
  return video
}

const cueMilliseconds = (stamp: string): number | null => {
  const parts = stamp.trim().match(/^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/u)
  if (!parts) return null
  const [hours, minutes, seconds, fraction] = [Number(parts[1] ?? 0), Number(parts[2]), Number(parts[3]), Number(parts[4]!.padEnd(3, '0'))]
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + fraction
}

export function extractTikTokTranscript(payload: string): { readonly text: string; readonly segments: readonly { readonly ordinal: number; readonly startMs: number; readonly endMs: number; readonly startByte: number; readonly endByte: number }[] } {
  if (!payload.trimStart().startsWith('WEBVTT')) throw new RangeError('TikTok captions are invalid')
  return extractCueTranscript(payload, 'TikTok')
}

export function extractCueTranscript(payload: string, label: string): { readonly text: string; readonly segments: readonly { readonly ordinal: number; readonly startMs: number; readonly endMs: number; readonly startByte: number; readonly endByte: number }[] } {
  let transcript = ''
  let byteOffset = 0
  const segments = payload.replace(/\r/gu, '\n').split(/\n{2,}/u).flatMap(block => {
    const lines = block.split('\n').map(line => line.trim()).filter(Boolean)
    const timingIndex = lines.findIndex(line => line.includes('-->'))
    if (timingIndex < 0) return []
    const [rawStart, rawEnd] = lines[timingIndex]!.split('-->')
    const startMs = cueMilliseconds(rawStart ?? '')
    const endMs = cueMilliseconds((rawEnd ?? '').trim().split(/\s+/u)[0] ?? '')
    const cueText = lines.slice(timingIndex + 1).join(' ').replace(/<[^>]*>/gu, '').replace(/\s+/gu, ' ').trim()
    if (startMs === null || endMs === null || !cueText) return []
    if (transcript) { transcript += '\n'; byteOffset += 1 }
    const startByte = byteOffset
    transcript += cueText
    byteOffset += new TextEncoder().encode(cueText).byteLength
    if (byteOffset > 1024 * 1024) throw new RangeError(`${label} transcript exceeds 1 MiB`)
    return [{ ordinal: 0, startMs, endMs: Math.max(startMs, endMs), startByte, endByte: byteOffset }]
  }).map((segment, ordinal) => ({ ...segment, ordinal }))
  if (!segments.length) throw new RangeError(`${label} captions contain no readable text`)
  return { text: transcript, segments }
}
