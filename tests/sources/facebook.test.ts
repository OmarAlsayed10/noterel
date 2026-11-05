import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { extractFacebookPost, extractFacebookVideo, facebookPostUrl, facebookVideoId, facebookVideoUrl } from '../../src/sources/facebook'
import { extractCueTranscript } from '../../src/sources/tiktok'

describe('facebook videos', () => {
  it('recognizes share, reel, and watch links', () => {
    expect(facebookVideoUrl('https://www.facebook.com/share/r/1SCeSrddhz/')).toBe(true)
    expect(facebookVideoId('https://www.facebook.com/reel/2053406978875286/?rdid=abc')).toBe('2053406978875286')
    expect(facebookVideoId('https://www.facebook.com/watch/?v=1102566674126730')).toBe('1102566674126730')
    expect(facebookVideoUrl('https://www.facebook.com/nasa')).toBe(false)
    expect(facebookPostUrl('https://www.facebook.com/share/p/1CJjuTgwCn/')).toBe(true)
    expect(facebookPostUrl('https://www.facebook.com/share/1DsX53nB2o/')).toBe(true)
    expect(facebookPostUrl('https://www.facebook.com/100006896801698/posts/4492352744337908/')).toBe(true)
    expect(facebookPostUrl('https://www.facebook.com/share/r/1SCeSrddhz/')).toBe(false)
    expect(facebookPostUrl('https://www.facebook.com/story.php?story_fbid=4671750636483552&id=100009459857517')).toBe(true)
  })
  it('extracts the auto-caption track without using the post description', () => {
    const html = readFileSync(new URL('../fixtures/facebook-reel.html', import.meta.url), 'utf8')
    const video = extractFacebookVideo(html, 'https://www.facebook.com/reel/2053406978875286/?rdid=zc9JnK5C66JJOwZC')
    expect(video.videoId).toBe('2053406978875286')
    expect(video.captionUrl).toMatch(/^https:\/\/scontent\.[\w.-]+\.fbcdn\.net\/.*\.srt/)
    expect(video.captionLanguage).toBe('ar-AR')
    expect(video.title).toMatch(/^Facebook Reel(?: by .+)?$/u)
  })
  it('extracts the complete Facebook post payload instead of the truncated preview', () => {
    const html = '<meta property="og:description" content="First paragraph ..."><meta property="og:image" content="https://scontent.example.fbcdn.net/photo.jpg">"message":{"text":"First paragraph.\\n\\nSecond paragraph with #ModularMonolith"}'
    expect(extractFacebookPost(html, 'https://www.facebook.com/100006896801698/posts/4492352744337908/')).toMatchObject({ text: 'First paragraph.\n\nSecond paragraph with #ModularMonolith', imageUrls: ['https://scontent.example.fbcdn.net/photo.jpg'] })
  })

  it('does not replace the post with a longer comment', () => {
    const html = '"message":{"text":"Original post text"},"comments":{"edges":[{"node":{"message":{"text":"A longer comment that must not become the saved note"}}}]}'
    expect(extractFacebookPost(html, 'https://www.facebook.com/story.php?story_fbid=4671750636483552&id=100009459857517').text).toBe('Original post text')
  })

  it('keeps Facebook post media without treating a Reel description as captions', () => {
    const html = '<meta property="og:description" content="Post text with a link"><meta property="og:image" content="https://scontent.example.fbcdn.net/photo.jpg">"permalink_url":"https:\\/\\/www.facebook.com\\/reel\\/2557561351376045\\/","message":{"text":"Full Facebook post text"}'
    expect(extractFacebookVideo(html, 'https://www.facebook.com/reel/2557561351376045/')).toMatchObject({ postText: null, imageUrls: ['https://scontent.example.fbcdn.net/photo.jpg'] })
  })

  it('does not expose a public description as caption text', () => {
    const video = extractFacebookVideo('<meta property="og:title" content="12K views | Public post"><meta property="og:description" content="Public post description">"permalink_url":"https:\\/\\/www.facebook.com\\/reel\\/2557561351376045\\/"', 'https://www.facebook.com/share/v/1K6C5mA4iP/')
    expect(video).toMatchObject({ captionUrl: null, title: 'Facebook Reel' })
    expect(video).not.toHaveProperty('description')
  })
  it('parses the SRT captions into a transcript', () => {
    const transcript = extractCueTranscript(readFileSync(new URL('../fixtures/facebook-reel.srt', import.meta.url), 'utf8'), 'Facebook')
    expect(transcript.segments.length).toBeGreaterThan(2)
    expect(transcript.segments[0]).toMatchObject({ startMs: 0, endMs: 8341 })
    expect(transcript.text).toContain('ولد بيقول لي')
  })

  it('preserves mixed Arabic and English caption text', () => {
    const transcript = extractCueTranscript('1\n00:00:00,000 --> 00:00:02,000\nأحسن من LinkedIn\n', 'Facebook')
    expect(transcript.text).toBe('أحسن من LinkedIn')
  })
})
