import { describe, expect, it } from 'vitest'
import { extractWebpage } from '../../src/sources/webpage'

describe('local webpage extraction', () => {
  it('extracts readable article text and metadata without script content', () => {
    const page = extractWebpage(`<html><head><title>Fallback</title><meta property="og:title" content="Saved &amp; private"><meta name="description" content="A useful page"><meta property="og:image" content="/cover.jpg"></head><body><nav>menu</nav><article><h1>Heading</h1><p>Readable &mdash; <a href="/detail">linked text</a>.</p><ul><li>First point</li><li>Second point</li></ul><script>steal()</script></article><footer>footer</footer></body></html>`, 'https://example.com/path')
    expect(page).toEqual({ title: 'Saved & private', description: 'A useful page', siteName: 'example.com', thumbnailUrl: 'https://example.com/cover.jpg', imageUrls: ['https://example.com/cover.jpg'], text: '# Heading\n\nReadable — [linked text](https://example.com/detail).\n\n- First point\n- Second point' })
  })

  it('keeps X post text, links, and post images without profile or engagement chrome', () => {
    const html = `<html><head><meta property="og:image" content="https://pbs.twimg.com/media/PhotoABC?format=webp&amp;name=large"></head><body><article><div>Other user's reply</div></article><article><a href="/writer/status/1234567890123456">timestamp</a><a href="/writer">Writer @writer</a><div class="font-chirp whitespace-pre-wrap break-words"><span>Useful post<br><br>Read the <a href="https://example.com/guide?a=1&amp;b=2">guide</a>.</span></div><img src="https://pbs.twimg.com/profile_images/avatar.jpg"><img src="https://tracker.example/media/PhotoABC"><img src="https://pbs.twimg.com/media/PhotoABC?format=webp&amp;name=large"><img src="https://pbs.twimg.com/media/PhotoDEF?format=jpg&amp;name=large"><span>10K Views</span><button>250 Likes</button></article></body></html>`
    expect(extractWebpage(html, 'https://x.com/writer/status/1234567890123456')).toEqual({ title: 'X · Useful post', description: null, siteName: 'X', text: 'Useful post\n\nRead the [guide](https://example.com/guide?a=1&b=2).', thumbnailUrl: 'https://pbs.twimg.com/media/PhotoABC?format=webp&name=large', imageUrls: ['https://pbs.twimg.com/media/PhotoABC?format=webp&name=large', 'https://pbs.twimg.com/media/PhotoDEF?format=jpg&name=large'], postProvider: 'x', socialContentVersion: 1 })
  })

  it('uses X post preview text when the page omits post markup', () => {
    const page = extractWebpage('<meta property="og:description" content="Post &amp; link"><meta property="og:image" content="https://pbs.twimg.com/profile_images/avatar.jpg"><body><nav>17K Views 90 Likes</nav></body>', 'https://twitter.com/writer/status/1234567890123456')
    expect(page).toEqual({ title: 'X · Post & link', description: null, siteName: 'X', text: 'Post & link', thumbnailUrl: null, imageUrls: [], postProvider: 'x', socialContentVersion: 1 })
  })

  it('chooses the complete article when a page contains a short article before it', () => {
    const page = extractWebpage('<body><article><p>Short navigation item</p></article><article><h1>Full article</h1><p>First paragraph.</p><p>Second paragraph.</p></article></body>', 'https://example.com/article')
    expect(page.text).toContain('First paragraph.')
    expect(page.text).toContain('Second paragraph.')
    expect(page.text).not.toContain('Short navigation item')
  })

  it('rejects empty pages and unsafe thumbnails', () => {
    expect(() => extractWebpage('<body><script>only()</script></body>', 'https://example.com')).toThrow('readable')
    expect(extractWebpage('<meta property="og:image" content="http://example.com/a"><body>text</body>', 'https://example.com').thumbnailUrl).toBeNull()
  })

  it('falls back to link-preview metadata when the body renders no text', () => {
    const shell = '<html><head><title>TikTok</title><meta property="og:title" content="Kestrel note"><meta property="og:description" content="اللهم ف حسن تدبيرك مايغني عن الحيل"></head><body><div id="app"></div></body></html>'
    const extracted = extractWebpage(shell, 'https://www.tiktok.com/@user/photo/123')
    expect(extracted.text).toBe('Kestrel note\n\nاللهم ف حسن تدبيرك مايغني عن الحيل')
    expect(extracted.description).toBe('اللهم ف حسن تدبيرك مايغني عن الحيل')
  })

  it('extracts the Instagram caption without engagement metadata or comments', () => {
    const html = '<meta property="og:image" content="https://scontent.example.cdninstagram.com/cover.jpg"><script>{"caption":{"text":"\\u2068Full caption\\nwith a link https://example.com\\u2069"},"comments":{"data":[{"text":"A comment that must not be saved"}]},"like_count":1200,"display_url":"https:\\/\\/scontent.example.cdninstagram.com\\/post.jpg"}</script>'
    expect(extractWebpage(html, 'https://www.instagram.com/p/ABC123/')).toEqual({ title: 'Instagram · Full caption', description: null, siteName: 'Instagram', thumbnailUrl: 'https://scontent.example.cdninstagram.com/cover.jpg', text: 'Full caption\nwith a link https://example.com', imageUrls: ['https://scontent.example.cdninstagram.com/cover.jpg', 'https://scontent.example.cdninstagram.com/post.jpg'], postProvider: 'instagram', socialContentVersion: 1 })
  })

  it.each([
    '<html><head><meta property="og:title" content="Reader on Instagram: &quot;The post description&quot;"></head><body>Log in Sign up</body></html>',
    '<html><body><script>"edge_media_to_caption":{"edges":[{"node":{"text":"أحسن من LinkedIn"}}]}</script></body></html>',
    '<html><head><meta property="og:description" content="1,200 likes, 12 comments - Reader on March 2: &quot;❤️&quot;"></head><body>Log in Sign up</body></html>'
  ])('does not treat Instagram descriptions or engagement metadata as captions', html => {
    expect(() => extractWebpage(html, 'https://www.instagram.com/reel/example/')).toThrow('post caption')
  })

  it('still refuses pages with neither body text nor preview metadata', () => {
    expect(() => extractWebpage('<html><head></head><body><div></div></body></html>', 'https://example.com/')).toThrow(/no readable text/u)
  })
})
