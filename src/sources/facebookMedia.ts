import { facebookVideoId } from './facebook'

const mediaFailure = 'Facebook did not expose downloadable audio for this video. Choose a video file instead.'
const xmlText = (text: string): string => text.replace(/&(?:amp|quot|apos|lt|gt);/gu, entity => ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' })[entity]!)

const mediaUrl = (rawUrl: string): string => {
  const url = new URL(rawUrl)
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.fbcdn.net') || url.username || url.password || url.port && url.port !== '443' || url.hash || new TextEncoder().encode(rawUrl).byteLength > 8192) throw new RangeError(mediaFailure)
  return rawUrl
}

function audioManifestUrl(manifest: unknown): string | null {
  if (typeof manifest !== 'string') return null
  for (const adaptation of manifest.matchAll(/<AdaptationSet\b([^>]*)>([\s\S]*?)<\/AdaptationSet>/gu)) {
    if (!/(?:mimeType=["']audio\/mp4["']|contentType=["']audio["'])/u.test(adaptation[1]!)) continue
    const audio = adaptation[2]!.match(/<BaseURL(?:\s[^>]*)?>([^<]+)<\/BaseURL>/u)?.[1]
    if (audio) return mediaUrl(xmlText(audio.trim()))
  }
  return null
}

function videoMediaNode(node: Record<string, unknown>, videoId: string): { readonly audio: string | null; readonly video: string | null } | null {
  if (node.id !== videoId) return null
  const legacy = typeof node.videoDeliveryLegacyFields === 'object' && node.videoDeliveryLegacyFields !== null ? node.videoDeliveryLegacyFields as Record<string, unknown> : node
  if (legacy.id !== videoId) return null
  return { audio: audioManifestUrl(legacy.dash_manifest_xml_string), video: typeof legacy.browser_native_sd_url === 'string' ? mediaUrl(legacy.browser_native_sd_url) : null }
}

function facebookScriptPayloads(html: string): unknown[] {
  const payloads: unknown[] = []
  for (const script of html.matchAll(/<script\b[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gu)) {
    try { payloads.push(JSON.parse(script[1]!)) } catch (error) { if (!(error instanceof SyntaxError)) throw error }
  }
  return payloads
}

export function facebookVideoMedia(html: string, requestedUrl: string, finalUrl: string): string {
  const videoId = facebookVideoId(finalUrl)
  const requestedId = facebookVideoId(requestedUrl)
  if (!videoId || requestedId && requestedId !== videoId) throw new RangeError(mediaFailure)
  const stack = facebookScriptPayloads(html)
  let video: string | null = null
  while (stack.length > 0) {
    const node = stack.pop()
    if (typeof node !== 'object' || node === null) continue
    const record = node as Record<string, unknown>
    const candidate = videoMediaNode(record, videoId)
    if (candidate?.audio) return candidate.audio
    if (candidate?.video) video ??= candidate.video
    for (const child of Object.values(record)) if (typeof child === 'object' && child !== null) stack.push(child)
  }
  if (video) return video
  throw new RangeError(mediaFailure)
}
