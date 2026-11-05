import { beforeEach, describe, expect, it, vi } from 'vitest'
import { chooseFile } from '../../src/capture/chooseFile'
import { transcriptionMediaKind } from '../../src/transcription/media'

const picker = vi.hoisted(() => vi.fn())
vi.mock('expo-document-picker', () => ({ getDocumentAsync: picker }))
vi.mock('expo-file-system', () => ({ File: class {} }))

describe('video transcription input', () => {
  beforeEach(() => picker.mockReset())

  it.each([
    ['video/mp4', 'clip.mp4', 'video'],
    ['video/quicktime', 'clip.mov', 'video'],
    ['application/octet-stream', 'CLIP.MKV', 'video'],
    [undefined, 'clip.webm', 'video'],
    ['audio/webm', 'recording.webm', 'audio'],
    ['application/ogg', 'voice', 'audio'],
    ['image/jpeg', 'photo.jpg', null]
  ] as const)('routes %s %s according to playable media', (mime, filename, expected) => {
    expect(transcriptionMediaKind(mime, filename)).toBe(expected)
  })

  it('offers video files without copying them before the size check', async () => {
    picker.mockResolvedValue({ canceled: false, assets: [{ uri: 'content://video/1', name: 'clip.mp4', size: 128 * 1024 * 1024, mimeType: 'video/mp4' }] })
    await expect(chooseFile('video')).resolves.toEqual({ kind: 'audio', audio: { uri: 'content://video/1', filename: 'clip.mp4', size: 128 * 1024 * 1024, mediaType: 'video/mp4' } })
    expect(picker).toHaveBeenCalledWith({ type: ['video/*'], copyToCacheDirectory: false, multiple: false })
  })

  it.each([undefined, 0, -1, Number.NaN, 128 * 1024 * 1024 + 1])('rejects unavailable or excessive video size %s before transcription', async size => {
    picker.mockResolvedValue({ canceled: false, assets: [{ uri: 'content://video/1', name: 'clip.mp4', size, mimeType: 'video/mp4' }] })
    await expect(chooseFile('video')).rejects.toThrow('128 MiB')
  })

  it('leaves capture unchanged when the video picker is cancelled', async () => {
    picker.mockResolvedValue({ canceled: true, assets: null })
    await expect(chooseFile('video')).resolves.toBeNull()
  })
})
