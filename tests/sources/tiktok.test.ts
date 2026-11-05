import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { extractTikTokTranscript, extractTikTokItem, previewTikTokCaptions, tiktokUrl } from '../../src/sources/tiktok'

const sourceBoundary = vi.hoisted(() => ({ fetchPublicSource: vi.fn() }))
vi.mock('../../modules/kestrel-source-processing', () => ({ default: sourceBoundary }))

const rehydration = readFileSync(new URL('../fixtures/tiktok-video-page.json', import.meta.url), 'utf8')
const photoRehydration = readFileSync(new URL('../fixtures/tiktok-photo-page.json', import.meta.url), 'utf8')
const captions = readFileSync(new URL('../fixtures/tiktok-captions.vtt', import.meta.url), 'utf8')
const page = `<html><head><title>TikTok</title></head><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${rehydration}</script></body></html>`
const photoPage = `<html><head><title>TikTok - Make Your Day</title></head><body><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${photoRehydration}</script></body></html>`
const requestedUrl = 'https://www.tiktok.com/@user41026039433676/video/7659901027692449032'

describe('local TikTok extraction', () => {
  it('recognizes TikTok links without accepting look-alike hosts', () => {
    expect(tiktokUrl('https://vt.tiktok.com/ZSqU5DWhy/')).toBe(true)
    expect(tiktokUrl('https://www.tiktok.com/@user/video/123')).toBe(true)
    expect(tiktokUrl('https://tiktok.com.example.com/@user/video/123')).toBe(false)
    expect(tiktokUrl('http://www.tiktok.com/@user/video/123')).toBe(false)
    expect(tiktokUrl('not a url')).toBe(false)
  })

  it('previews the original language and alternatives before saving a shared short link', async () => {
    sourceBoundary.fetchPublicSource.mockResolvedValueOnce({ finalUrl: requestedUrl, mediaType: 'text/html', text: page.replace('"subtitleInfos": [', '"subtitleInfos": [{"LanguageCodeName":"eng-US","Format":"webvtt","Source":"MT","Url":"https://v16-webapp.tiktok.com/translated.vtt"},') })
    await expect(previewTikTokCaptions('https://vt.tiktok.com/ZSqcALa3n/')).resolves.toMatchObject({ captionLanguage: 'ara-SA', captionLanguages: ['eng-US', 'ara-SA'] })
  })

  it('reads the caption track from the shared page payload', () => {
    const video = extractTikTokItem(page, requestedUrl)
    expect(video).toMatchObject({ videoId: '7659901027692449032', author: 'محبين/ الشيخ رمضان ⛎', durationMs: 59000, captionLanguage: 'ara-SA', captionSource: 'ASR' })
    expect(video?.canonicalUrl).toBe(requestedUrl)
    expect(video?.captionUrl).toMatch(/^https:\/\/[\w.-]+\.tiktok\.com\//u)
  })

  it('requires an explicit language choice before importing machine-translated captions', () => {
    const translatedPage = page.replace('ara-SA', 'eng-US').replace('"Source": "ASR"', '"Source": "MT"')
    expect(extractTikTokItem(translatedPage, requestedUrl)).toMatchObject({ captionLanguage: null, captionUrl: null, captionLanguages: ['eng-US'] })
    expect(extractTikTokItem(translatedPage, requestedUrl, 'eng-US')).toMatchObject({ captionLanguage: 'eng-US', captionSource: 'MT' })
  })

  it('does not guess between multiple speech-caption languages', () => {
    const secondSpeechTrack = '{"LanguageCodeName":"eng-US","Format":"webvtt","Source":"ASR","Url":"https://v16-webapp.tiktok.com/english.vtt"},'
    const multilingualPage = page.replace('"subtitleInfos": [', `"subtitleInfos": [${secondSpeechTrack}`)
    expect(extractTikTokItem(multilingualPage, requestedUrl)).toMatchObject({ captionLanguage: null, captionUrl: null })
    expect(extractTikTokItem(multilingualPage, requestedUrl, 'ara-SA')).toMatchObject({ captionLanguage: 'ara-SA', captionSource: 'ASR' })
  })

  it.each(['ara-SA', 'spa-ES'])('saves %s speech rather than the English machine translation', spokenLanguage => {
    const translatedTrack = '{"LanguageCodeName":"eng-US","Format":"webvtt","Source":"MT","Url":"https://v16-webapp.tiktok.com/translated.vtt"},'
    const multilingualPage = page.replace('"subtitleInfos": [', `"subtitleInfos": [${translatedTrack}`).replace('ara-SA', spokenLanguage)
    const video = extractTikTokItem(multilingualPage, requestedUrl)
    expect(video).toMatchObject({ captionLanguage: spokenLanguage, captionSource: 'ASR' })
    expect(video?.captionUrl).not.toContain('translated.vtt')
  })

  it('reads original captions from the current TikTok api-data page format', () => {
    const scope = (JSON.parse(rehydration) as { __DEFAULT_SCOPE__: Record<string, unknown> }).__DEFAULT_SCOPE__
    const detail = scope['webapp.reflow.video.detail']
    const translatedTrack = '{"LanguageCodeName":"eng-US","Format":"webvtt","Source":"MT","Url":"https://v16-webapp.tiktok.com/translated.vtt"},'
    const apiPayload = JSON.stringify({ videoDetail: detail }).replace('"subtitleInfos":[', `"subtitleInfos":[${translatedTrack}`)
    const apiPage = `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">{"__DEFAULT_SCOPE__":{}}</script><script id="api-data" type="application/json">${apiPayload}</script></html>`
    expect(extractTikTokItem(apiPage, requestedUrl)).toMatchObject({ captionLanguage: 'ara-SA', captionSource: 'ASR' })
  })

  it('uses authored captions in the spoken language over auto-generated captions', () => {
    const authoredTrack = '{"LanguageCodeName":"ara-SA","Format":"webvtt","Source":"CC","Url":"https://v16-webapp.tiktok.com/authored.vtt"},'
    const bilingualPage = page.replace('"subtitleInfos": [', `"subtitleInfos": [${authoredTrack}`)
    expect(extractTikTokItem(bilingualPage, requestedUrl)).toMatchObject({ captionLanguage: 'ara-SA', captionSource: 'CC', captionUrl: 'https://v16-webapp.tiktok.com/authored.vtt' })
  })

  it('does not confuse a different-language authored track with the original speech', () => {
    const otherLanguageTrack = '{"LanguageCodeName":"eng-US","Format":"webvtt","Source":"CC","Url":"https://v16-webapp.tiktok.com/english.vtt"},'
    const bilingualPage = page.replace('"subtitleInfos": [', `"subtitleInfos": [${otherLanguageTrack}`)
    expect(extractTikTokItem(bilingualPage, requestedUrl)).toMatchObject({ captionLanguage: 'ara-SA', captionSource: 'ASR' })
  })

  it('requires a choice when two authored languages have no identified speech track', () => {
    const englishTrack = '{"LanguageCodeName":"eng-US","Format":"webvtt","Source":"CC","Url":"https://v16-webapp.tiktok.com/english.vtt"},'
    const ambiguousPage = page.replace('"subtitleInfos": [', `"subtitleInfos": [${englishTrack}`).replace('"Source": "ASR"', '"Source": "CC"')
    expect(extractTikTokItem(ambiguousPage, requestedUrl)).toMatchObject({ captionUrl: null, captionLanguages: ['eng-US', 'ara-SA'] })
    expect(extractTikTokItem(ambiguousPage, requestedUrl, 'ara-SA')).toMatchObject({ captionLanguage: 'ara-SA', captionSource: 'CC' })
    expect(extractTikTokItem(ambiguousPage, requestedUrl, 'eng-US')).toMatchObject({ captionLanguage: 'eng-US', captionUrl: 'https://v16-webapp.tiktok.com/english.vtt' })
    expect(extractTikTokItem(ambiguousPage, requestedUrl, 'fra-FR')?.captionUrl).toBeNull()
  })

  it('returns nothing when the page carries no video payload', () => {
    expect(extractTikTokItem('<html><body>no payload</body></html>', requestedUrl)).toBeNull()
    expect(extractTikTokItem('<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__">not json</script>', requestedUrl)).toBeNull()
  })

  it('rejects caption URLs that leave TikTok', () => {
    const hijacked = page.replace(/"Url":\s*"[^"]*"/u, '"Url": "https://attacker.example.com/steal.vtt"')
    expect(extractTikTokItem(hijacked, requestedUrl)?.captionUrl).toBeNull()
  })

  it('builds byte-addressed segments from the WebVTT track', () => {
    const transcript = extractTikTokTranscript(captions)
    expect(transcript.segments.length).toBeGreaterThan(5)
    expect(transcript.text.split('\n')).toHaveLength(transcript.segments.length)
    expect(transcript.segments[0]).toMatchObject({ ordinal: 0, startMs: 0, endMs: 2200, startByte: 0 })
    const first = transcript.segments[0]!
    expect(new TextEncoder().encode(transcript.text).slice(first.startByte, first.endByte)).toEqual(new TextEncoder().encode('اقولك على سنة حلوة قوي قوي قوي'))
    expect(transcript.segments.every((segment, index) => segment.ordinal === index && segment.endMs >= segment.startMs)).toBe(true)
  })

  it('refuses payloads that are not WebVTT captions', () => {
    expect(() => extractTikTokTranscript('{"events":[]}')).toThrow(/invalid/u)
    expect(() => extractTikTokTranscript('WEBVTT\n\n')).toThrow(/no readable text/u)
  })

  it('does not expose a photo-post description as timed captions', () => {
    const post = extractTikTokItem(photoPage, 'https://vt.tiktok.com/ZSqy1rqgs/')
    expect(post).toMatchObject({ videoId: '7492787649518767378', imageCount: 1, captionUrl: null, captionLanguage: null, title: 'TikTok post by اذكر الله' })
    expect(post?.canonicalUrl).toBe('https://www.tiktok.com/@bgeiksh/photo/7492787649518767378')
    expect(post).not.toHaveProperty('description')
  })
})
