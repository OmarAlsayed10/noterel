interface ExtractedWebpage {
  readonly title: string | null
  readonly description: string | null
  readonly siteName: string | null
  readonly thumbnailUrl: string | null
  readonly text: string
  readonly imageUrls?: readonly string[]
  readonly postProvider?: 'x' | 'instagram'
  readonly socialContentVersion?: number
}

const namedEntities: Readonly<Record<string, string>> = { amp: '&', apos: "'", gt: '>', lt: '<', mdash: '—', nbsp: ' ', quot: '"' }

const decodedEntity = (entity: string): string => {
  if (!entity.startsWith('#')) return namedEntities[entity.toLocaleLowerCase()] ?? `&${entity};`
  const codePoint = entity[1]?.toLocaleLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
  if (!Number.isInteger(codePoint) || codePoint < 1 || codePoint > 0x10ffff || codePoint >= 0xd800 && codePoint <= 0xdfff) return '�'
  return String.fromCodePoint(codePoint)
}

const decodedEntities = (text: string): string => text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (_, entity: string) => decodedEntity(entity))

const plainText = (html: string): string => decodedEntities(html.replace(/<[^>]+>/gu, ' ').replace(/\s+/gu, ' ').trim())

const safeLink = (rawUrl: string | undefined, finalUrl: string): string | null => {
  if (!rawUrl) return null
  try {
    const url = new URL(decodedEntities(rawUrl), finalUrl)
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null
  } catch {
    return null
  }
}

const linkedHtml = (html: string, finalUrl: string): string => html.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/giu, (_, rawAttributes: string, body: string) => {
  const label = plainText(body)
  const url = safeLink(attributes(`<a ${rawAttributes}>`).href, finalUrl)
  return label && url ? `[${label}](${url})` : label
})

const markdownBlocks = (html: string, finalUrl: string): string => {
  const linked = linkedHtml(readableHtml(html), finalUrl)
  return linked
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/giu, (_, body: string) => `\n\n\`\`\`\n${decodedEntities(body.replace(/<[^>]+>/gu, '')).trim().replace(/```/gu, '`` `')}\n\`\`\`\n\n`)
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/giu, (_, level: string, body: string) => `\n\n${Number(level) === 1 ? '#' : '##'} ${plainText(body)}\n\n`)
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/giu, (_, body: string) => `\n\n> ${plainText(body)}\n\n`)
    .replace(/<li\b[^>]*>([\s\S]*?)<\/li>/giu, (_, body: string) => `\n- ${plainText(body)}\n`)
    .replace(/<(p|figcaption|dt|dd)\b[^>]*>([\s\S]*?)<\/\1>/giu, (_, _tag: string, body: string) => `\n\n${plainText(body)}\n\n`)
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(/<\/?(?:article|body|div|main|section|table|tbody|thead|tr|ul|ol)\b[^>]*>/giu, '\n')
}

const normalizedMarkdown = (html: string, finalUrl: string): string => decodedEntities(markdownBlocks(html, finalUrl).replace(/<[^>]+>/gu, ' '))
  .split('\n').map(line => line.replace(/[\t ]+/gu, ' ').trim()).join('\n').replace(/\n{3,}/gu, '\n\n').replace(/(\n- [^\n]+)\n\n(?=- )/gu, '$1\n').trim()

const attributes = (tag: string): Readonly<Record<string, string>> => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu)].map(match => [match[1]!.toLocaleLowerCase(), decodedEntities(match[2] ?? match[3] ?? '')]))

const metadata = (html: string): ReadonlyMap<string, string> => {
  const entries = [...html.matchAll(/<meta\b[^>]*>/giu)].flatMap(match => {
    const values = attributes(match[0])
    const key = values.property ?? values.name
    return key && values.content ? [[key.toLocaleLowerCase(), values.content] as const] : []
  })
  return new Map(entries)
}

export const safeImageUrl = (rawUrl: string | undefined, finalUrl: string): string | null => {
  if (!rawUrl) return null
  try {
    const url = new URL(rawUrl, finalUrl)
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null
  } catch {
    return null
  }
}

const readableHtml = (html: string): string => {
  const cleaned = html.replace(/<(script|style|noscript|svg|nav|footer|form|aside)\b[^>]*>[\s\S]*?<\/\1>/giu, ' ')
  const articles = [...cleaned.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/giu)].map(match => match[0])
  return articles.sort((left, right) => plainText(right).length - plainText(left).length)[0] ?? cleaned.match(/<body\b[^>]*>([\s\S]*?)<\/body>/iu)?.[1] ?? cleaned
}

const xPostId = (rawUrl: string): string | null => {
  const url = new URL(rawUrl)
  if (!/(^|\.)(?:x\.com|twitter\.com)$/iu.test(url.hostname)) return null
  return /^\/(?:[A-Za-z0-9_]{1,32}|i)\/status\/(\d{6,20})(?:\/|$)/u.exec(url.pathname)?.[1] ?? null
}

export const xPostUrl = (rawUrl: string): boolean => xPostId(rawUrl) !== null

export const xMediaUrl = (rawUrl: string): string | null => {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'https:' && url.hostname === 'pbs.twimg.com' && !url.username && !url.password && !url.port && /^\/media\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9]+)?$/u.test(url.pathname) && url.toString().length <= 2048 ? url.toString() : null
  } catch {
    return null
  }
}

const extractedXPost = (html: string, finalUrl: string, pageMetadata: ReadonlyMap<string, string>): ExtractedWebpage => {
  const postId = xPostId(finalUrl)!
  const article = [...html.matchAll(/<article\b[^>]*>[\s\S]*?<\/article>/giu)].map(match => match[0]).find(candidate => candidate.includes(`/status/${postId}`))
  const body = article?.match(/<div\b[^>]*data-testid=(?:"tweetText"|'tweetText')[^>]*>([\s\S]*?)<\/div>/iu)?.[1]
    ?? article?.match(/<div\b[^>]*class=(?:"[^"]*whitespace-pre-wrap[^"]*"|'[^']*whitespace-pre-wrap[^']*')[^>]*>([\s\S]*?)<\/div>/iu)?.[1]
  const text = body ? normalizedMarkdown(body, finalUrl) : pageMetadata.get('og:description')?.trim() ?? ''
  if (!text) throw new RangeError('X did not expose the post text')
  const articleImages = article ? [...article.matchAll(/<img\b[^>]*>/giu)].map(match => attributes(match[0]).src) : []
  const imageUrls = [...new Set([...articleImages, pageMetadata.get('og:image')].flatMap(url => url ? [xMediaUrl(url)].filter((media): media is string => media !== null) : []))].slice(0, 8)
  const heading = text.split('\n').find(line => line.trim())?.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/gu, '$1').trim() ?? 'Post'
  return { title: `X · ${heading.slice(0, 96)}`, description: null, siteName: 'X', thumbnailUrl: imageUrls[0] ?? null, text, imageUrls, postProvider: 'x', socialContentVersion: 1 }
}

export const instagramPostUrl = (rawUrl: string): boolean => {
  const url = new URL(rawUrl)
  return /(^|\.)instagram\.com$/iu.test(url.hostname) && /^\/(?:p|reel|tv)\//u.test(url.pathname)
}

const decodedJsonString = (value: string): string | null => {
  try {
    return JSON.parse(`"${value}"`).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu, '').trim() || null
  } catch {
    return null
  }
}

const extractedInstagramPost = (html: string, finalUrl: string, pageMetadata: ReadonlyMap<string, string>): ExtractedWebpage => {
  const captionValue = html.match(/"caption"\s*:\s*\{\s*"text"\s*:\s*"((?:\\.|[^"\\])*)"/u)?.[1]
  const text = captionValue ? decodedJsonString(captionValue) : null
  if (!text) throw new RangeError('Instagram did not expose the post caption')
  const embeddedImageUrls = [...html.matchAll(/display_url":"([^"]+)/gu), ...html.matchAll(/thumbnail_src":"([^"]+)/gu)].map(match => decodedJsonString(match[1]!))
  const imageUrls = [...new Set([pageMetadata.get('og:image'), ...embeddedImageUrls].flatMap(url => url ? [safeImageUrl(url, finalUrl)].filter((image): image is string => image !== null) : []))].slice(0, 8)
  const heading = text.split('\n').find(line => line.trim())?.slice(0, 96) ?? 'Post'
  return { title: `Instagram · ${heading}`, description: null, siteName: 'Instagram', thumbnailUrl: imageUrls[0] ?? null, text, imageUrls, postProvider: 'instagram', socialContentVersion: 1 }
}

export function extractWebpage(html: string, finalUrl: string): ExtractedWebpage {
  const pageMetadata = metadata(html)
  const titleElement = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/iu)?.[1]
  const title = pageMetadata.get('og:title') ?? pageMetadata.get('twitter:title') ?? (titleElement ? plainText(titleElement) : null)
  const description = pageMetadata.get('og:description')?.trim() || pageMetadata.get('twitter:description')?.trim() || pageMetadata.get('description')?.trim() || null
  if (instagramPostUrl(finalUrl)) return extractedInstagramPost(html, finalUrl, pageMetadata)
  if (xPostUrl(finalUrl)) return extractedXPost(html, finalUrl, pageMetadata)
  const text = normalizedMarkdown(html, finalUrl) || [title?.trim(), description].filter(Boolean).join('\n\n')
  if (!text) throw new RangeError('Webpage contains no readable text')
  return {
    title: title?.trim() || null,
    description,
    siteName: pageMetadata.get('og:site_name')?.trim() || new URL(finalUrl).hostname,
    thumbnailUrl: safeImageUrl(pageMetadata.get('og:image') ?? pageMetadata.get('twitter:image'), finalUrl),
    imageUrls: [...new Set([pageMetadata.get('og:image'), pageMetadata.get('twitter:image')].flatMap(url => url ? [safeImageUrl(url, finalUrl)].filter((image): image is string => image !== null) : []))].slice(0, 8),
    text
  }
}
