import { describe, expect, it } from 'vitest'
import { extractYouTubeClientConfig, extractYouTubeTranscript, extractYouTubeVideo, extractYouTubeVideoResponse, youtubeVideoId } from '../../src/sources/youtube'

const player = {
  videoDetails: { title: 'Private memory', author: 'Kestrel Channel', lengthSeconds: '125', shortDescription: 'Useful description' },
  captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'ar', kind: 'asr', baseUrl: 'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=ar' }, { languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?v=abcdefghijk&lang=en' }] } }
}

const watchHtml = `<html><script>ytInitialPlayerResponse = ${JSON.stringify(player)};</script></html>`

describe('local YouTube extraction', () => {
  it('normalizes supported video identities and metadata', () => {
    expect(youtubeVideoId('https://youtu.be/abcdefghijk')).toBe('abcdefghijk')
    expect(youtubeVideoId('https://www.youtube.com/watch?v=abcdefghijk')).toBe('abcdefghijk')
    expect(youtubeVideoId('https://example.com/watch?v=abcdefghijk')).toBeNull()
    const video = extractYouTubeVideo('https://youtu.be/abcdefghijk', watchHtml)
    expect(video).toMatchObject({ videoId: 'abcdefghijk', title: 'Private memory', channel: 'Kestrel Channel', durationMs: 125000, captionLanguage: 'ar' })
    expect(video).not.toHaveProperty('description')
    expect(extractYouTubeVideoResponse('https://youtu.be/abcdefghijk', JSON.stringify(player)).captionLanguage).toBe('ar')
    expect(extractYouTubeClientConfig('"INNERTUBE_API_KEY":"AIzaSyExample_public-client-key_123"')).toEqual({ apiKey: 'AIzaSyExample_public-client-key_123' })
  })

  it.each([
    [[{ languageCode: 'en' }, { languageCode: 'ar', kind: 'asr' }], 'ar'],
    [[{ languageCode: 'en' }, { languageCode: 'ar', kind: 'asr' }, { languageCode: 'ar', baseUrl: 'https://www.youtube.com/api/timedtext?lang=ar&name=authored' }], 'ar'],
    [[{ languageCode: 'en', kind: 'asr' }], 'en'],
    [[{ languageCode: 'ar' }], 'ar']
  ] as const)('keeps the spoken language for %j', (captionTracks, expectedLanguage) => {
    const payload = { ...player, captions: { playerCaptionsTracklistRenderer: { captionTracks } } }
    expect(extractYouTubeVideoResponse('https://youtu.be/abcdefghijk', JSON.stringify(payload)).captionLanguage).toBe(expectedLanguage)
  })

  it.each([
    [{ languageCode: 'en' }, { languageCode: 'ar' }],
    [{ languageCode: 'en', kind: 'asr' }, { languageCode: 'ar', kind: 'asr' }],
    [{ languageCode: 'en', baseUrl: 'https://www.youtube.com/api/timedtext?lang=ar&tlang=en' }]
  ])('does not import a guessed or auto-translated caption language from %j', (...captionTracks) => {
    const payload = { ...player, captions: { playerCaptionsTracklistRenderer: { captionTracks } } }
    expect(extractYouTubeVideoResponse('https://youtu.be/abcdefghijk', JSON.stringify(payload))).toMatchObject({ captionLanguage: null, captionUrl: null })
  })

  it('builds bounded byte-addressed caption segments', () => {
    const transcript = extractYouTubeTranscript(JSON.stringify({ events: [
      { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: 'first' }] },
      { tStartMs: 1000, dDurationMs: 2000, segs: [{ utf8: 'مرحبا' }] }
    ] }))
    expect(transcript.text).toBe('first\nمرحبا')
    expect(transcript.segments).toEqual([
      { ordinal: 0, startMs: 0, endMs: 1000, startByte: 0, endByte: 5 },
      { ordinal: 1, startMs: 1000, endMs: 3000, startByte: 6, endByte: 16 }
    ])
  })

  it('rejects incomplete player and caption payloads', () => {
    expect(() => extractYouTubeVideo('https://youtu.be/abcdefghijk', '<html />')).toThrow()
    expect(() => extractYouTubeTranscript('{}')).toThrow('transcript')
  })
})
