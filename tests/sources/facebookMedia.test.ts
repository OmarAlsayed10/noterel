import { describe, expect, it } from 'vitest'
import { facebookVideoMedia } from '../../src/sources/facebookMedia'

const videoId = '2311888832944538'
const requestedUrl = 'https://www.facebook.com/share/v/1HWHi6QbX4/'
const finalUrl = `https://www.facebook.com/reel/${videoId}/`
const audioUrl = 'https://video.example.fbcdn.net/audio.mp4?first=1&second=2'
const videoUrl = 'https://video.example.fbcdn.net/video.mp4'
const script = (payload: unknown): string => `<script type="application/json">${JSON.stringify(payload)}</script>`
const media = (id: string, audio = audioUrl, video = videoUrl) => ({ id, videoDeliveryLegacyFields: { id, browser_native_sd_url: video, dash_manifest_xml_string: `<MPD><AdaptationSet mimeType="audio/mp4"><Representation><BaseURL>${audio.replaceAll('&', '&amp;')}</BaseURL></Representation></AdaptationSet></MPD>` } })

describe('Facebook video without captions', () => {
  it('uses audio from the requested video instead of a related video or the heavier SD stream', () => {
    const html = script({ related: media('9999999999999', 'https://video.example.fbcdn.net/other.mp4'), target: media(videoId) })
    expect(facebookVideoMedia(html, requestedUrl, finalUrl)).toBe(audioUrl)
  })

  it('falls back to the target SD stream when no audio manifest is exposed', () => {
    expect(facebookVideoMedia(script({ id: videoId, browser_native_sd_url: videoUrl }), requestedUrl, finalUrl)).toBe(videoUrl)
  })

  it.each([
    [requestedUrl, requestedUrl],
    ['https://www.facebook.com/reel/9999999999999/', finalUrl]
  ])('rejects an unresolved or replaced target identity', (requested, final) => {
    expect(() => facebookVideoMedia(script(media(videoId)), requested, final)).toThrow('Choose a video file')
  })

  it('does not substitute a related stream when the requested video has no downloadable media', () => {
    expect(() => facebookVideoMedia(script(media('9999999999999')), requestedUrl, finalUrl)).toThrow('Choose a video file')
  })

  it.each(['http://video.example.fbcdn.net/video.mp4', 'https://fbcdn.net.evil.example/video.mp4', 'https://user:secret@video.example.fbcdn.net/video.mp4', 'https://video.example.fbcdn.net:8443/video.mp4', 'https://video.example.fbcdn.net/video.mp4#fragment'])('rejects unsafe stream destinations', url => {
    expect(() => facebookVideoMedia(script({ id: videoId, browser_native_sd_url: url }), requestedUrl, finalUrl)).toThrow('Choose a video file')
  })

  it('ignores unrelated malformed script data while retaining the matching media payload', () => {
    expect(facebookVideoMedia('<script type="application/json">invalid</script>' + script(media(videoId)), requestedUrl, finalUrl)).toBe(audioUrl)
  })
})
