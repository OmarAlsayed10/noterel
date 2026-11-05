import { originalYouTubeCaption } from './caption-language'

interface YouTubeClientConfig {
  readonly apiKey: string
}

interface ExtractedYouTubeVideo {
  readonly videoId: string
  readonly canonicalUrl: string
  readonly title: string
  readonly channel: string
  readonly durationMs: number
  readonly captionLanguage: string | null
  readonly captionUrl: string | null
  readonly thumbnailUrl: string
}

const youtubeHosts = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be', 'youtube-nocookie.com', 'www.youtube-nocookie.com'])

export const youtubeVideoId = (rawUrl: string): string | null => {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:' || !youtubeHosts.has(url.hostname.toLocaleLowerCase())) return null
  const parts = url.pathname.split('/').filter(Boolean)
  const candidate = url.hostname.toLocaleLowerCase().includes('youtu.be') ? parts[0] : url.pathname === '/watch' ? url.searchParams.get('v') : ['shorts', 'embed'].includes(parts[0] ?? '') ? parts[1] : null
  return candidate && /^[A-Za-z0-9_-]{11}$/u.test(candidate) ? candidate : null
}

const jsonObjectAt = (text: string, start: number): string => {
  let depth = 0
  let quoted = false
  let escaped = false
  for (let index = start; index < text.length; index += 1) {
    const character = text[index]!
    if (quoted) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
    } else if (character === '"') quoted = true
    else if (character === '{') depth += 1
    else if (character === '}' && --depth === 0) return text.slice(start, index + 1)
  }
  throw new RangeError('YouTube metadata is incomplete')
}

const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new RangeError('YouTube metadata is invalid')
  return value as Record<string, unknown>
}

const playerResponse = (html: string): Record<string, unknown> => {
  const marker = 'ytInitialPlayerResponse = '
  const markerIndex = html.indexOf(marker)
  const start = html.indexOf('{', markerIndex < 0 ? 0 : markerIndex + marker.length)
  if (markerIndex < 0 || start < 0) throw new RangeError('YouTube metadata is unavailable')
  return record(JSON.parse(jsonObjectAt(html, start)))
}

export function extractYouTubeClientConfig(html: string): YouTubeClientConfig {
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([A-Za-z0-9_-]{20,64})"/u)?.[1]
  if (!apiKey) throw new RangeError('YouTube client configuration is unavailable')
  return { apiKey }
}

const extractedVideo = (rawUrl: string, player: Record<string, unknown>): ExtractedYouTubeVideo => {
  const videoId = youtubeVideoId(rawUrl)
  if (!videoId) throw new RangeError('YouTube URL is invalid')
  const details = record(player.videoDetails)
  const captions = player.captions ? record(player.captions) : null
  const renderer = captions?.playerCaptionsTracklistRenderer ? record(captions.playerCaptionsTracklistRenderer) : null
  const tracks = Array.isArray(renderer?.captionTracks) ? renderer.captionTracks.map(record) : []
  const track = originalYouTubeCaption(tracks)
  const durationSeconds = Number(details.lengthSeconds)
  if (typeof details.title !== 'string' || typeof details.author !== 'string' || !Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 86_400) throw new RangeError('YouTube metadata is incomplete')
  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
    title: details.title.slice(0, 512),
    channel: details.author.slice(0, 512),
    durationMs: durationSeconds * 1000,
    captionLanguage: typeof track?.languageCode === 'string' ? track.languageCode.slice(0, 32) : null,
    captionUrl: typeof track?.baseUrl === 'string' ? track.baseUrl : null,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
  }
}

export const extractYouTubeVideo = (rawUrl: string, html: string): ExtractedYouTubeVideo => extractedVideo(rawUrl, playerResponse(html))
export const extractYouTubeVideoResponse = (rawUrl: string, payload: string): ExtractedYouTubeVideo => extractedVideo(rawUrl, record(JSON.parse(payload)))

export function extractYouTubeTranscript(payload: string): { readonly text: string; readonly segments: readonly { readonly ordinal: number; readonly startMs: number; readonly endMs: number; readonly startByte: number; readonly endByte: number }[] } {
  const events = record(JSON.parse(payload)).events
  if (!Array.isArray(events)) throw new RangeError('YouTube transcript is invalid')
  let text = ''
  let byteOffset = 0
  const segments = events.flatMap(event => {
    const entry = record(event)
    const segmentText = Array.isArray(entry.segs) ? entry.segs.map(segment => record(segment).utf8).filter((part): part is string => typeof part === 'string').join('').replace(/\s+/gu, ' ').trim() : ''
    if (!Number.isInteger(entry.tStartMs) || !Number.isInteger(entry.dDurationMs) || !segmentText) return []
    if (text) { text += '\n'; byteOffset += 1 }
    const startByte = byteOffset
    text += segmentText
    byteOffset += new TextEncoder().encode(segmentText).byteLength
    if (byteOffset > 1024 * 1024) throw new RangeError('YouTube transcript exceeds 1 MiB')
    return [{ ordinal: 0, startMs: Number(entry.tStartMs), endMs: Number(entry.tStartMs) + Number(entry.dDurationMs), startByte, endByte: byteOffset }]
  }).map((segment, ordinal) => ({ ...segment, ordinal }))
  return { text, segments }
}
