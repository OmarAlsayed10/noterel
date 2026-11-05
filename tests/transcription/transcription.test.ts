import { beforeEach, describe, expect, it, vi } from 'vitest'
import { audioTranscriptionJobs, cancelTranscriptionModelDownload, installedTranscriptionModels, startAudioTranscription, transcriptionModelDownloadState } from '../../src/transcription/transcription'
import { setLanguage } from '../../src/i18n'

const native = vi.hoisted(() => ({ audioTranscriptionJobs: vi.fn(), cancelTranscriptionModelDownload: vi.fn(), enqueueAudioTranscription: vi.fn(), installedTranscriptionModels: vi.fn(), transcriptionModelDownloadState: vi.fn() }))

vi.mock('../../modules/kestrel-source-processing', () => ({ default: native }))
vi.mock('react-native', () => ({ PermissionsAndroid: {}, Platform: { OS: 'web', Version: 0 } }))
vi.mock('expo-file-system', () => ({ File: class {}, Paths: { cache: { uri: 'file:///cache/' } } }))

const audio = { uri: 'content://audio/1', filename: 'voice.opus', size: 2048, mediaType: 'audio/opus' }

describe('offline audio transcription boundary', () => {
  beforeEach(() => {
    native.audioTranscriptionJobs.mockReset()
    native.cancelTranscriptionModelDownload.mockReset()
    native.enqueueAudioTranscription.mockReset()
    native.installedTranscriptionModels.mockReset()
    native.transcriptionModelDownloadState.mockReset()
    setLanguage('en')
  })

  it('filters unknown native model identifiers', async () => {
    native.installedTranscriptionModels.mockResolvedValue(['small', 'unknown'])
    await expect(installedTranscriptionModels()).resolves.toEqual(['small'])
  })

  it('validates background download progress', async () => {
    native.transcriptionModelDownloadState.mockResolvedValue({ state: 'downloading', downloadedBytes: 50, totalBytes: 100 })
    await expect(transcriptionModelDownloadState('small')).resolves.toEqual({ state: 'downloading', downloadedBytes: 50, totalBytes: 100 })
  })

  it('cancels the selected background download', async () => {
    native.cancelTranscriptionModelDownload.mockResolvedValue(undefined)
    await cancelTranscriptionModelDownload('medium')
    expect(native.cancelTranscriptionModelDownload).toHaveBeenCalledWith('medium')
  })

  it('validates persisted background jobs before showing them', async () => {
    const job = { id: '123e4567-e89b-42d3-a456-426614174000', state: 'transcribing', progress: 45, title: 'voice.opus', text: null, durationSeconds: null, error: null }
    native.audioTranscriptionJobs.mockResolvedValue([job])
    await expect(audioTranscriptionJobs()).resolves.toEqual([job])
  })

  it.each([['auto', 'en'], ['auto', 'ar'], ['ar', 'en'], ['en', 'ar']] as const)('queues %s speech separately from the %s interface language', async (spokenLanguage, interfaceLanguage) => {
    setLanguage(interfaceLanguage)
    native.enqueueAudioTranscription.mockResolvedValue('job-id')
    await expect(startAudioTranscription(audio, 'small', spokenLanguage)).resolves.toBe('job-id')
    expect(native.enqueueAudioTranscription).toHaveBeenCalledWith(audio.uri, audio.filename, { model: 'small', language: spokenLanguage, interfaceLanguage })
  })

  it('retains the native detected source languages when reading the transcript', async () => {
    const job = { id: '123e4567-e89b-42d3-a456-426614174000', state: 'succeeded', progress: 100, text: 'مرحبا', detectedLanguages: ['ar'] }
    native.audioTranscriptionJobs.mockResolvedValue([job])
    await expect(audioTranscriptionJobs()).resolves.toEqual([job])
  })

  it('rejects oversized audio before copying it into a background job', async () => {
    await expect(startAudioTranscription({ ...audio, size: 128 * 1024 * 1024 + 1 }, 'small', 'en')).rejects.toThrow('128 MiB')
    expect(native.enqueueAudioTranscription).not.toHaveBeenCalled()
  })

  it('queues a video audio track through the existing local transcription job', async () => {
    native.enqueueAudioTranscription.mockResolvedValue('video-job')
    const video = { uri: 'content://video/1', filename: 'clip.mp4', size: 1024, mediaType: 'video/mp4' }
    await expect(startAudioTranscription(video, 'small', 'ar')).resolves.toBe('video-job')
    expect(native.enqueueAudioTranscription).toHaveBeenCalledWith(video.uri, video.filename, { model: 'small', language: 'ar', interfaceLanguage: 'en' })
  })

  it('persists and decodes the original video identity across the native job boundary', async () => {
    const origin = { url: 'https://www.facebook.com/share/v/1HWHi6QbX4/', thumbnailUrl: 'https://images.example.com/video.jpg', captureId: '123e4567-e89b-42d3-a456-426614174001', capturePayloadSha256: 'a'.repeat(64) }
    native.enqueueAudioTranscription.mockResolvedValue('job-id')
    await startAudioTranscription({ ...audio, origin }, 'medium', 'en')
    expect(native.enqueueAudioTranscription).toHaveBeenCalledWith(audio.uri, audio.filename, { model: 'medium', language: 'en', interfaceLanguage: 'en', originJson: JSON.stringify(origin) })
    const job = { id: '123e4567-e89b-42d3-a456-426614174000', state: 'succeeded', progress: 100, text: 'Seven levels.' }
    native.audioTranscriptionJobs.mockResolvedValue([{ ...job, originJson: JSON.stringify(origin) }])
    await expect(audioTranscriptionJobs()).resolves.toEqual([{ ...job, origin }])
  })

  it.each([{ originJson: '{' }, { originJson: '{}' }, { originReadError: true }])('keeps a damaged-source job removable without hiding valid jobs: %j', async damagedOrigin => {
    const valid = { id: '123e4567-e89b-42d3-a456-426614174000', state: 'succeeded', progress: 100, text: 'Saved speech.' }
    const damaged = { ...valid, id: '123e4567-e89b-42d3-a456-426614174001', ...damagedOrigin }
    native.audioTranscriptionJobs.mockResolvedValue([valid, damaged])
    const jobs = await audioTranscriptionJobs()
    expect(jobs[0]).toEqual(valid)
    expect(jobs[1]).toMatchObject({ id: damaged.id, state: 'failed', text: 'Saved speech.' })
    expect(jobs[1]!.origin).toBeUndefined()
    expect(jobs[1]!.error).toContain('video source')
  })
})
