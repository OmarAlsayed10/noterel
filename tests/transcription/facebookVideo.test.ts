import { beforeEach, describe, expect, it, vi } from 'vitest'
import { prepareFacebookVideo } from '../../src/transcription/facebookVideo'

const native = vi.hoisted(() => ({ fetchFacebookVideo: vi.fn(), prepareFacebookVideoMedia: vi.fn(), cancelFacebookVideoMedia: vi.fn(), releaseFacebookVideoMedia: vi.fn(), deleteFile: vi.fn() }))
vi.mock('../../modules/kestrel-source-processing', () => ({ default: native }))
vi.mock('expo-crypto', () => ({ randomUUID: () => '123e4567-e89b-42d3-a456-426614174000' }))
vi.mock('react-native', () => ({ PermissionsAndroid: {}, Platform: { OS: 'web', Version: 0 } }))
vi.mock('expo-file-system', () => ({ File: class { exists = true; delete = native.deleteFile }, Paths: { cache: { uri: 'file:///cache/' } } }))

const url = 'https://www.facebook.com/share/v/1HWHi6QbX4/'
const candidate = { uri: 'file:///cache/facebook-video-1.mp4', filename: 'Facebook video audio.mp4', mediaType: 'audio/mp4', size: 670191 }
const page = { finalUrl: 'https://www.facebook.com/reel/2311888832944538/', html: '<script type="application/json">{"id":"2311888832944538","browser_native_sd_url":"https://video.example.fbcdn.net/video.mp4"}</script>' }

describe('Facebook audio preparation boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    native.fetchFacebookVideo.mockResolvedValue(page)
    native.prepareFacebookVideoMedia.mockResolvedValue(candidate)
  })

  it('returns a temporary playable candidate without claiming a transcript', async () => {
    await expect(prepareFacebookVideo(url)).resolves.toEqual({ ...candidate, origin: { url, title: null, thumbnailUrl: null } })
    expect(native.releaseFacebookVideoMedia).toHaveBeenCalledWith('123e4567-e89b-42d3-a456-426614174000')
  })

  it('preserves the preparation failure so the saved reference can offer file recovery', async () => {
    native.prepareFacebookVideoMedia.mockRejectedValue(new Error('Facebook video audio could not be downloaded'))
    await expect(prepareFacebookVideo(url)).rejects.toThrow('could not be downloaded')
    expect(native.releaseFacebookVideoMedia).toHaveBeenCalledOnce()
  })

  it('does not start a transfer after cancellation during page lookup', async () => {
    const controller = new AbortController()
    native.fetchFacebookVideo.mockImplementation(async () => { controller.abort(); return page })
    await expect(prepareFacebookVideo(url, controller.signal)).rejects.toThrow('cancelled')
    expect(native.prepareFacebookVideoMedia).not.toHaveBeenCalled()
  })

  it('removes a late temporary candidate when the view was cancelled while downloading', async () => {
    const controller = new AbortController()
    native.prepareFacebookVideoMedia.mockImplementation(async () => { controller.abort(); return candidate })
    await expect(prepareFacebookVideo(url, controller.signal)).rejects.toThrow('cancelled')
    expect(native.cancelFacebookVideoMedia).toHaveBeenCalledOnce()
    expect(native.deleteFile).toHaveBeenCalledOnce()
  })
})
