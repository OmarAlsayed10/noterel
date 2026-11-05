import type { SQLiteDatabase } from 'expo-sqlite'
import { randomUUID } from 'expo-crypto'
import { withDatabaseTransaction } from '../storage/database'
import { emptyLearningDetails, learningDetailsSchema, learningEnvelopeSchema } from './schema'
import type { LearningDetails, MemoryIdentity, MemoryLearningEntry } from './schema'
import { learningOrigin, recordLearningAlias, resolveLearningAlias, storedMemoryIdentity } from './identity'

export { canonicalMemoryIdentity, learningOrigin } from './identity'

interface LearningRow {
  readonly origin_id: string
  readonly source_id: string
  readonly details_json: string
  readonly revision: number
  readonly dirty: number
  readonly conflict: number
  readonly remote_json: string | null
  readonly updated_at_ms: number
}

function learningEntry(row: LearningRow): MemoryLearningEntry {
  return { identity: { sourceId: row.source_id, mailboxId: row.origin_id === 'phone' ? null : row.origin_id }, details: learningDetailsSchema.parse(JSON.parse(row.details_json)), revision: row.revision, dirty: row.dirty === 1, conflict: row.conflict === 1, remote: row.remote_json ? learningEnvelopeSchema.parse(JSON.parse(row.remote_json)) : null, updatedAtMs: row.updated_at_ms }
}

export async function storedLearningEntry(database: SQLiteDatabase, identity: MemoryIdentity): Promise<MemoryLearningEntry> {
  const resolved = await storedMemoryIdentity(database, identity)
  const row = await database.getFirstAsync<LearningRow>('SELECT * FROM memory_learning WHERE origin_id=? AND source_id=?', learningOrigin(resolved), resolved.sourceId)
  return row ? learningEntry(row) : { identity: resolved, details: emptyLearningDetails(), revision: 0, dirty: false, conflict: false, remote: null, updatedAtMs: 0 }
}

export function memoryLearning(identity: MemoryIdentity): Promise<MemoryLearningEntry> {
  return withDatabaseTransaction(database => storedLearningEntry(database, identity))
}

export async function saveMemoryLearning(identity: MemoryIdentity, detailsInput: LearningDetails): Promise<MemoryLearningEntry> {
  const details = learningDetailsSchema.parse(detailsInput)
  await withDatabaseTransaction(async database => {
    const resolved = await storedMemoryIdentity(database, identity)
    await database.runAsync(`INSERT INTO memory_learning(origin_id,source_id,details_json,revision,dirty,conflict,updated_at_ms) VALUES(?,?,?,0,1,0,?)
      ON CONFLICT(origin_id,source_id) DO UPDATE SET details_json=excluded.details_json,dirty=1,updated_at_ms=max(excluded.updated_at_ms,memory_learning.updated_at_ms+1)`, learningOrigin(resolved), resolved.sourceId, JSON.stringify(details), Date.now())
  })
  return memoryLearning(identity)
}

export async function learningIndex(): Promise<readonly MemoryLearningEntry[]> {
  return withDatabaseTransaction(async database => (await database.getAllAsync<LearningRow>('SELECT * FROM memory_learning ORDER BY updated_at_ms DESC')).map(learningEntry))
}

function combinedDetails(previous: LearningDetails, target: LearningDetails): LearningDetails {
  const annotations = new Map(target.annotations.map(annotation => [annotation.id, annotation]))
  for (const annotation of previous.annotations) {
    const existing = annotations.get(annotation.id)
    if (!existing) annotations.set(annotation.id, annotation)
    else if (JSON.stringify(existing) !== JSON.stringify(annotation)) { const copy = { ...annotation, id: randomUUID() }; annotations.set(copy.id, copy) }
  }
  const collections = new Map([...previous.collections, ...target.collections].map(name => [name.toLocaleLowerCase(), name]))
  return learningDetailsSchema.parse({ takeaway: previous.takeaway === target.takeaway || !previous.takeaway ? target.takeaway : !target.takeaway ? previous.takeaway : `${previous.takeaway}\n\n${target.takeaway}`, collections: [...collections.values()], revisit: previous.revisit || target.revisit, annotations: [...annotations.values()] })
}

export async function importLearningDetails(database: SQLiteDatabase, identity: MemoryIdentity, detailsInput: LearningDetails): Promise<void> {
  const incoming = learningDetailsSchema.parse(detailsInput)
  const resolved = await storedMemoryIdentity(database, identity)
  const existing = await database.getFirstAsync<LearningRow>('SELECT * FROM memory_learning WHERE origin_id=? AND source_id=?', learningOrigin(resolved), resolved.sourceId)
  const details = existing ? combinedDetails(incoming, learningEntry(existing).details) : incoming
  await database.runAsync(`INSERT INTO memory_learning(origin_id,source_id,details_json,revision,dirty,conflict,updated_at_ms) VALUES(?,?,?,0,1,0,?)
    ON CONFLICT(origin_id,source_id) DO UPDATE SET details_json=excluded.details_json,dirty=1,updated_at_ms=max(excluded.updated_at_ms,memory_learning.updated_at_ms+1)`, learningOrigin(resolved), resolved.sourceId, JSON.stringify(details), Date.now())
}

export async function rebindLearningIdentity(database: SQLiteDatabase, previous: MemoryIdentity, target: MemoryIdentity): Promise<void> {
  if (previous.mailboxId && previous.mailboxId !== target.mailboxId) throw new RangeError('Personal notes cannot be reassigned to another Desktop')
  const oldIdentity = await resolveLearningAlias(database, previous)
  const newIdentity = previous.mailboxId ? target : await resolveLearningAlias(database, target)
  if (learningOrigin(oldIdentity) === learningOrigin(newIdentity) && oldIdentity.sourceId === newIdentity.sourceId) return
  await moveLearningEntry(database, oldIdentity, newIdentity)
  await recordLearningAlias(database, oldIdentity, newIdentity)
}

async function moveLearningEntry(database: SQLiteDatabase, previous: MemoryIdentity, target: MemoryIdentity): Promise<void> {
  const old = await database.getFirstAsync<LearningRow>('SELECT * FROM memory_learning WHERE origin_id=? AND source_id=?', learningOrigin(previous), previous.sourceId)
  if (!old) return
  const existing = await database.getFirstAsync<LearningRow>('SELECT * FROM memory_learning WHERE origin_id=? AND source_id=?', learningOrigin(target), target.sourceId)
  if (old.remote_json && existing?.remote_json && old.remote_json !== existing.remote_json) throw new Error('Resolve personal note conflicts before merging different copies')
  const details = existing ? combinedDetails(learningEntry(old).details, learningEntry(existing).details) : learningEntry(old).details
  const dirty = old.dirty === 1 || existing?.dirty === 1 || previous.mailboxId !== target.mailboxId || !!existing && JSON.stringify(details) !== existing.details_json
  await database.runAsync(`INSERT INTO memory_learning(origin_id,source_id,details_json,revision,dirty,conflict,remote_json,updated_at_ms) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(origin_id,source_id) DO UPDATE SET details_json=excluded.details_json,dirty=excluded.dirty,conflict=excluded.conflict,remote_json=excluded.remote_json,updated_at_ms=max(excluded.updated_at_ms,memory_learning.updated_at_ms+1)`, learningOrigin(target), target.sourceId, JSON.stringify(details), existing?.revision ?? (previous.mailboxId === target.mailboxId ? old.revision : 0), dirty ? 1 : 0, old.conflict || existing?.conflict ? 1 : 0, existing?.remote_json ?? old.remote_json, Math.max(Date.now(), old.updated_at_ms + 1))
  await database.runAsync('DELETE FROM memory_learning WHERE origin_id=? AND source_id=?', learningOrigin(previous), previous.sourceId)
}

export async function removeMemoryLearningInDatabase(database: SQLiteDatabase, identity: MemoryIdentity): Promise<readonly string[]> {
  const resolved = await storedMemoryIdentity(database, identity)
  const aliases = await database.getAllAsync<{ source_id: string }>(`WITH RECURSIVE family(source_id) AS (
    SELECT ? UNION SELECT alias.source_id FROM memory_learning_aliases alias JOIN family ON alias.target_source_id=family.source_id WHERE alias.origin_id=?
  ) SELECT source_id FROM family`, resolved.sourceId, learningOrigin(resolved))
  const sourceIds = [resolved.sourceId, ...aliases.map(alias => alias.source_id).filter(sourceId => sourceId !== resolved.sourceId)]
  const placeholders = sourceIds.map(() => '?').join(',')
  await database.runAsync(`DELETE FROM memory_learning WHERE origin_id=? AND source_id IN (${placeholders})`, learningOrigin(resolved), ...sourceIds)
  await database.runAsync(`DELETE FROM memory_learning_aliases WHERE origin_id=? AND source_id IN (${placeholders})`, learningOrigin(resolved), ...sourceIds)
  return sourceIds
}

export async function removeMemoryLearning(identity: MemoryIdentity): Promise<void> {
  await withDatabaseTransaction(database => removeMemoryLearningInDatabase(database, identity))
}
