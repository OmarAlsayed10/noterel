import { Directory, File, Paths } from 'expo-file-system'
import { openEncryptedDatabase, withDatabaseTransaction } from '../../storage/database'
import type { AudioCandidate } from '../transcription'
import { storedCloudJobSchema, type StoredCloudJob } from './protocol'

async function cloudJobsDatabase() {
  const database = await openEncryptedDatabase()
  await database.execAsync('CREATE TABLE IF NOT EXISTS cloud_transcription_jobs (id TEXT PRIMARY KEY, endpoint TEXT NOT NULL, payload_json TEXT NOT NULL)')
  return database
}

export async function storedCloudJobs(endpoint: string, accountId: string): Promise<readonly StoredCloudJob[]> {
  const rows = await (await cloudJobsDatabase()).getAllAsync<{ payload_json: string }>('SELECT payload_json FROM cloud_transcription_jobs WHERE endpoint=? ORDER BY rowid', endpoint)
  return rows.map(row => storedCloudJobSchema.parse(JSON.parse(row.payload_json))).filter(job => job.accountId === accountId)
}

export async function storeCloudJob(job: StoredCloudJob): Promise<void> {
  const validated = storedCloudJobSchema.parse(job)
  await cloudJobsDatabase()
  await withDatabaseTransaction(async database => {
    await database.runAsync('INSERT INTO cloud_transcription_jobs(id,endpoint,payload_json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload_json=excluded.payload_json WHERE endpoint=excluded.endpoint', validated.id, validated.endpoint, JSON.stringify(validated))
  })
}

export async function removeStoredCloudJob(job: StoredCloudJob): Promise<void> {
  await (await cloudJobsDatabase()).runAsync('DELETE FROM cloud_transcription_jobs WHERE id=? AND endpoint=?', job.id, job.endpoint)
  deleteCloudAudio(job.audioUri)
}

export async function keepCloudAudio(audio: AudioCandidate, id: string): Promise<string> {
  const directory = new Directory(Paths.document, 'transcription-beta')
  directory.create({ intermediates: true, idempotent: true })
  const target = new File(directory, id)
  try {
    await new File(audio.uri).copy(target)
    if (target.size <= 0 || target.size > 128 * 1024 * 1024) throw new RangeError('Choose audio or video no larger than 128 MiB')
    return target.uri
  } catch (error) {
    if (target.exists) target.delete()
    throw error
  }
}

export function deleteCloudAudio(uri: string | null): void {
  if (!uri) return
  const file = new File(uri)
  if (file.exists) file.delete()
}
