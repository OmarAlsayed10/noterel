export interface ExtractedFacebookVideo {
  readonly videoId: string
  readonly canonicalUrl: string
  readonly title: string
  readonly owner: string | null
  readonly captionUrl: string | null
  readonly captionLanguage: string | null
  readonly postText: string | null
  readonly imageUrls: readonly string[]
}

const facebookHosts = /(^|\.)(facebook\.com|fb\.watch)$/iu
const facebookImageHosts = /(^|\.)(fbcdn\.net|fbsbx\.com)$/iu

const decodedEntities = (value: string): string => value.replace(/&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/giu, (_, entity: string) => {
  const normalized = entity.toLowerCase()
  if (normalized === 'amp') return '&'
  if (normalized === 'apos') return "'"
  if (normalized === 'gt') return '>'
  if (normalized === 'lt') return '<'
  if (normalized === 'nbsp') return ' '
  if (normalized === 'quot') return '"'
  const codePoint = normalized.startsWith('#x') ? Number.parseInt(normalized.slice(2), 16) : Number.parseInt(normalized.slice(1), 10)
  return Number.isInteger(codePoint) ? String.fromCodePoint(codePoint) : '�'
})

const attributes = (tag: string): Readonly<Record<string, string>> => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu)].map(match => [match[1]!.toLowerCase(), decodedEntities(match[2] ?? match[3] ?? '')]))

const metadata = (html: string): ReadonlyMap<string, string> => new Map([...html.matchAll(/<meta\b[^>]*>/giu)].flatMap(match => {
  const values = attributes(match[0])
  const key = values.property ?? values.name
  return key && values.content ? [[key.toLowerCase(), values.content] as const] : []
}))

const safeFacebookImage = (rawUrl: string): string | null => {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:' && !url.username && !url.password && facebookImageHosts.test(url.hostname) && url.toString().length <= 2048 ? url.toString() : null
  } catch {
    return null
  }
}

const decodedFacebookString = (value: string): string | null => {
  try {
    const decoded = JSON.parse(`"${value}"`).trim()
    return decoded || null
  } catch {
    return null
  }
}

const facebookMessages = (html: string): readonly string[] => [...html.matchAll(/"message"\s*:\s*\{[\s\S]{0,3000}?"text"\s*:\s*"((?:\\.|[^"\\])*)"/gu)].flatMap(match => {
  const message = decodedFacebookString(match[1]!)
  return message ? [message] : []
})

const facebookMessage = (html: string): string | null => facebookMessages(html)[0] ?? null

const postImages = (html: string): readonly string[] => {
  const pageMetadata = metadata(html)
  return [...new Set([pageMetadata.get('og:image'), ...[...html.matchAll(/<img\b[^>]*>/giu)].map(match => attributes(match[0]).src)].flatMap(url => url ? [safeFacebookImage(url)].filter((image): image is string => image !== null) : []))].slice(0, 8)
}

export const facebookVideoId = (rawUrl: string): string | null => {
  const url = new URL(rawUrl)
  if (!facebookHosts.test(url.hostname)) return null
  return url.pathname.match(/^\/(?:reel|videos)\/(\d{6,32})\/?$/u)?.[1] ?? url.pathname.match(/^\/[^/]+\/videos\/(\d{6,32})\/?$/u)?.[1] ?? (url.pathname.startsWith('/watch') ? url.searchParams.get('v')?.match(/^\d{6,32}$/u)?.[0] ?? null : null)
}

export const facebookVideoUrl = (rawUrl: string): boolean => {
  const url = new URL(rawUrl)
  return facebookHosts.test(url.hostname) && (facebookVideoId(rawUrl) !== null || /^\/share\/[rv]\/[\w-]+\/?$/u.test(url.pathname) || url.hostname.toLowerCase().endsWith('fb.watch'))
}

export const facebookPostUrl = (rawUrl: string): boolean => {
  const url = new URL(rawUrl)
  return facebookHosts.test(url.hostname) && (/^\/share\/(?:p\/[\w-]+|(?![rv]\/)[\w-]+)\/?$/u.test(url.pathname) || url.pathname === '/story.php' && Boolean(url.searchParams.get('story_fbid') || url.searchParams.get('post_id')) || /\/posts\/(?:pfbid[\w]+|\d{6,32})\/?$/u.test(url.pathname))
}

export function extractFacebookPost(html: string, finalUrl: string): { readonly canonicalUrl: string; readonly title: string; readonly text: string; readonly imageUrls: readonly string[] } {
  if (!facebookPostUrl(finalUrl)) throw new RangeError('Facebook post URL is invalid')
  const text = facebookMessage(html)
  if (!text) throw new RangeError('Facebook did not expose the full post text')
  const owner = html.match(/"owner":\{"__typename":"(?:User|Page)","name":"((?:\\.|[^"\\])*)"/u)?.[1]
  const title = owner ? `Facebook post by ${decodedFacebookString(owner) ?? 'Facebook'}` : 'Facebook post'
  return { canonicalUrl: finalUrl, title, text, imageUrls: postImages(html) }
}

export function facebookVideoPreview(html: string): { readonly title: string | null; readonly thumbnailUrl: string | null } {
  const tags = metadata(html)
  return { title: tags.get('og:title')?.trim().slice(0, 200) || null, thumbnailUrl: postImages(html)[0] ?? null }
}

export function extractFacebookVideo(html: string, finalUrl: string): ExtractedFacebookVideo {
  const videoId = facebookVideoId(finalUrl) ?? html.match(/"permalink_url":"https:\\\/\\\/www\.facebook\.com\\\/reel\\\/(\d{6,32})\\\/?"/u)?.[1] ?? null
  if (!videoId) throw new RangeError('Facebook video identifier is missing')
  const escapedId = videoId.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const localesMatch = html.match(new RegExp(String.raw`"permalink_url":"https:\\/\\/www\.facebook\.com\\/reel\\/` + escapedId + String.raw`\\/"[\s\S]{0,6000}?"video_available_captions_locales":(\[(?:\{[^{}]*\})*\])`, 'u'))
    ?? html.match(new RegExp(String.raw`"id":"` + escapedId + String.raw`"[\s\S]{0,6000}?"video_available_captions_locales":(\[(?:\{[^{}]*\})*\])`, 'u'))
  let captionUrl: string | null = null
  let captionLanguage: string | null = null
  if (localesMatch?.[1]) {
    const locales = (JSON.parse(localesMatch[1]) as { captions_url?: unknown; locale?: unknown; localized_creation_method?: unknown }[]).filter(locale => typeof locale.captions_url === 'string' && locale.captions_url.startsWith('https://'))
    const preferred = locales.find(locale => !/translat|ترجم/iu.test(String(locale.localized_creation_method ?? ''))) ?? locales[0]
    if (preferred) {
      captionUrl = preferred.captions_url as string
      captionLanguage = typeof preferred.locale === 'string' ? preferred.locale.replace('_', '-') : null
    }
  }
  const ownerMatch = html.match(/"owner":\{"__typename":"(?:User|Page)","name":"([^"]{1,200})"/u)
  const owner = ownerMatch?.[1] ? JSON.parse(`"${ownerMatch[1]}"`) as string : null
  return { videoId, canonicalUrl: `https://www.facebook.com/reel/${videoId}/`, title: owner ? `Facebook Reel by ${owner}` : 'Facebook Reel', owner, captionUrl, captionLanguage, postText: null, imageUrls: postImages(html) }
}
