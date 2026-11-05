import { beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { sqliteBoundary } from '../library/databaseFixture'

const boundaries = vi.hoisted(() => ({
  secure: new Map<string, string>(),
  files: new Map<string, number>(),
  request: vi.fn(),
  upload: vi.fn()
}))
const database = await sqliteBoundary().openDatabaseAsync()
vi.mock('../../src/storage/database', () => ({
  openEncryptedDatabase: async () => database,
  withDatabaseTransaction: async (run: (connection: typeof database) => Promise<unknown>) => {
    let saved: unknown
    await database.withTransactionAsync(async () => { saved = await run(database) })
    return saved
  }
}))
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }))
vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => boundaries.secure.get(key) ?? null,
  deleteItemAsync: async (key: string) => { boundaries.secure.delete(key) },
  setItemAsync: async (key: string, text: string) => { boundaries.secure.set(key, text) }
}))
vi.mock('expo-crypto', () => ({ randomUUID: () => randomUUID(), getRandomBytesAsync: async (count: number) => new Uint8Array(count).fill(7) }))
vi.mock('expo/fetch', () => ({ fetch: boundaries.request }))
vi.mock('../../modules/kestrel-source-processing', () => ({ default: { uploadTranscriptionBetaFile: boundaries.upload } }))
vi.mock('expo-file-system', () => ({
  Paths: { document: { uri: 'file:///private/' } },
  Directory: function (parent: { uri: string }, name: string) { return { uri: `${parent.uri}${name}/`, create: () => undefined } },
  File: function (parent: string | { uri: string }, name = '') {
    const uri = (typeof parent === 'string' ? parent : parent.uri) + name
    return {
      uri,
      get exists() { return boundaries.files.has(uri) },
      get size() { return boundaries.files.get(uri) ?? 0 },
      copy: async (destination: { uri: string }) => { boundaries.files.set(destination.uri, boundaries.files.get(uri) ?? 0) },
      delete: () => { boundaries.files.delete(uri) }
    }
  }
}))

const { activateCloudBeta, authenticatedCloudAccess, cloudAccess, configureCloudEndpoint, resetCloudAccess } = await import('../../src/transcription/cloud/account')
const { cloudTranscriptionJob, deleteCloudTranscriptionJob, refreshCloudJobs, retryCloudUpload, startCloudTranscription } = await import('../../src/transcription/cloud/jobs')
const { storedCloudJobs } = await import('../../src/transcription/cloud/storage')
const endpoint = 'https://beta.example.com'
const accountId = '123e4567-e89b-42d3-a456-426614174000'
const account = { accountId, remainingSeconds: 7200, reservedSeconds: 0, expiresAt: '2030-01-01T00:00:00.000Z' }
const token = 'a'.repeat(43)
const response = (status: number, body: unknown) => ({ status, text: async () => JSON.stringify(body) })
const activated = () => response(200, { token, account })
const audio = { uri: 'content://recording', filename: 'شرح '.repeat(100) + '.m4a', size: 4096, mediaType: 'audio/mp4', origin: { url: 'https://www.facebook.com/share/v/example/', captureId: '123e4567-e89b-42d3-a456-426614174001', capturePayloadSha256: 'a'.repeat(64) } }

beforeEach(async () => {
  boundaries.secure.clear()
  boundaries.files.clear()
  boundaries.request.mockReset()
  boundaries.upload.mockReset()
  await database.execAsync('DROP TABLE IF EXISTS cloud_transcription_jobs')
  await configureCloudEndpoint(endpoint)
})

describe('cloud beta recovery boundaries', () => {
  it('recovers a lost activation response using the same secret despite code formatting, then replaces revoked access without changing the account', async () => {
    boundaries.request.mockRejectedValueOnce(new Error('Connection lost'))
    await expect(activateCloudBeta('ABCD-EFGH')).rejects.toThrow('Connection lost')
    const pending = (await cloudAccess())!.activation!
    expect(pending.code).toBe('ABCDEFGH')
    boundaries.request.mockResolvedValueOnce(activated())
    await activateCloudBeta('abcd efgh')
    const replay = JSON.parse(boundaries.request.mock.calls[1]![1].body)
    expect(replay).toEqual(pending)
    await expect(configureCloudEndpoint('https://another.example.com')).rejects.toThrow('linked')
    boundaries.request.mockResolvedValueOnce(response(409, { error: { code: 'invitation_redeemed' } }))
    await expect(activateCloudBeta('USED-CODE')).rejects.toThrow('already used')
    boundaries.request.mockResolvedValueOnce(activated())
    await activateCloudBeta('RECOVERY-CODE')
    expect((await authenticatedCloudAccess()).accountId).toBe(accountId)
  })

  it('keeps the same upload identity, file and video origin through process-recovery polling, then reviews the accepted result offline', async () => {
    boundaries.request.mockResolvedValueOnce(activated())
    await activateCloudBeta('ABCD-EFGH')
    boundaries.files.set(audio.uri, audio.size)
    const id = await startCloudTranscription(audio, 'ar')
    const staging = { id, state: 'queued', progress: 0, uploadAccepted: false }
    boundaries.upload.mockResolvedValueOnce({ status: 202, body: JSON.stringify(staging) })
    await retryCloudUpload(id)
    boundaries.request.mockResolvedValueOnce(response(200, { jobs: [staging] }))
    const pending = (await refreshCloudJobs())[0]!
    expect(pending.uploadPending).toBe(true)
    expect(boundaries.files.has(pending.audioUri!)).toBe(true)
    expect(pending.origin).toEqual(audio.origin)
    const completed = { ...staging, state: 'succeeded', progress: 100, uploadAccepted: true, durationSeconds: 95, text: 'النص الكامل' }
    boundaries.upload.mockResolvedValueOnce({ status: 202, body: JSON.stringify(completed) })
    await retryCloudUpload(id)
    expect(boundaries.upload.mock.calls.map(call => call[1].url)).toEqual([`${endpoint}/v1/beta/jobs/${id}`, `${endpoint}/v1/beta/jobs/${id}`])
    expect(new TextEncoder().encode(boundaries.upload.mock.calls[0]![1].filename).length).toBeLessThanOrEqual(512)
    const ready = (await storedCloudJobs(endpoint, accountId))[0]!
    expect(ready.audioUri).toBeNull()
    expect(boundaries.files.has(pending.audioUri!)).toBe(false)
    boundaries.request.mockRejectedValue(new Error('Offline'))
    await expect(cloudTranscriptionJob(id)).resolves.toMatchObject({ id, text: 'النص الكامل', origin: audio.origin })
  })

  it('retains a rejected upload until an authenticated discard tombstone succeeds, and isolates a replacement identity', async () => {
    boundaries.request.mockResolvedValueOnce(activated())
    await activateCloudBeta('ABCD-EFGH')
    boundaries.files.set(audio.uri, audio.size)
    const id = await startCloudTranscription(audio, 'auto')
    boundaries.upload.mockResolvedValueOnce({ status: 503, body: JSON.stringify({ error: { code: 'server_busy' } }) })
    await expect(retryCloudUpload(id)).rejects.toThrow('not ready')
    const retained = (await storedCloudJobs(endpoint, accountId))[0]!
    boundaries.request.mockResolvedValueOnce(response(409, { error: { code: 'job_active' } }))
    await expect(deleteCloudTranscriptionJob(id)).rejects.toThrow('current cloud task')
    expect(boundaries.files.has(retained.audioUri!)).toBe(true)
    boundaries.request.mockResolvedValueOnce(response(200, { token, account: { ...account, accountId: randomUUID() } }))
    await activateCloudBeta('DIFFERENT-INVITE')
    await expect(retryCloudUpload(id)).rejects.toThrow('unavailable on this phone')
    boundaries.request.mockResolvedValueOnce(activated())
    await activateCloudBeta('ORIGINAL-RECOVERY')
    boundaries.request.mockResolvedValueOnce(response(204, null))
    await deleteCloudTranscriptionJob(id)
    expect(await storedCloudJobs(endpoint, accountId)).toEqual([])
    expect(boundaries.files.has(retained.audioUri!)).toBe(false)
    const recovered = { id: randomUUID(), state: 'queued', progress: 0, uploadAccepted: false, title: 'Restored task' }
    boundaries.request.mockResolvedValue(response(200, { jobs: [recovered] }))
    await refreshCloudJobs()
    const restored = (await refreshCloudJobs())[0]!
    expect(restored.uploadPending).toBe(false)
    expect(restored.audioUri).toBeNull()
    expect(restored.origin).toBeUndefined()
    await resetCloudAccess()
    await configureCloudEndpoint('https://corrected.example.com')
    await expect(authenticatedCloudAccess()).rejects.toThrow('Activate your invitation')
    expect((await storedCloudJobs(endpoint, accountId))[0]!.id).toBe(recovered.id)
  })
})
