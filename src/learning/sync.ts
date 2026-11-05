import type { MobileResponse } from '../companion/protocol'
import { z } from 'zod'
import { openEncryptedDatabase, withDatabaseTransaction } from '../storage/database'
import { learningOrigin, memoryLearning, rebindLearningIdentity, storedLearningEntry } from './repository'
import { resolveLearningAlias } from './identity'
import { learningEnvelopeSchema } from './schema'
import type { LearningEnvelope, MemoryIdentity, MemoryLearningEntry } from './schema'

interface LearningRequester {
  readonly mailboxId: string
  readonly request: (request: { method: 'GET' | 'PUT'; path: string; body: unknown }) => Promise<MobileResponse>
}

const learningPath = (sourceId: string): string => `/api/v1/companion/learning/${sourceId}`

function responseEnvelope(response: MobileResponse): LearningEnvelope {
  if (response.status < 200 || response.status >= 300) throw new Error(`Personal notes could not sync (Desktop ${response.status})`)
  return learningEnvelopeSchema.parse(response.body)
}

async function fetchLearning(requester: LearningRequester, sourceId: string): Promise<LearningEnvelope> {
  return responseEnvelope(await requester.request({ method: 'GET', path: learningPath(sourceId), body: null }))
}

async function installPulledLearning(snapshot: MemoryLearningEntry, remote: LearningEnvelope): Promise<void> {
  await withDatabaseTransaction(async database => {
    const resolved = await resolveLearningAlias(database, snapshot.identity)
    if (resolved.sourceId !== snapshot.identity.sourceId) return
    await database.runAsync(`INSERT INTO memory_learning(origin_id,source_id,details_json,revision,dirty,conflict,updated_at_ms) VALUES(?,?,?,?,0,0,?)
      ON CONFLICT(origin_id,source_id) DO UPDATE SET details_json=excluded.details_json,revision=excluded.revision,dirty=0,conflict=0,remote_json=NULL
      WHERE memory_learning.updated_at_ms=? AND memory_learning.revision=? AND memory_learning.dirty=?`, learningOrigin(snapshot.identity), snapshot.identity.sourceId, JSON.stringify(remote.details), remote.revision, snapshot.updatedAtMs, snapshot.updatedAtMs, snapshot.revision, snapshot.dirty ? 1 : 0)
  })
}

async function installAcknowledgedLearning(snapshot: MemoryLearningEntry, remote: LearningEnvelope): Promise<void> {
  await withDatabaseTransaction(async database => {
    const resolved = await resolveLearningAlias(database, snapshot.identity)
    await database.runAsync(`INSERT INTO memory_learning(origin_id,source_id,details_json,revision,dirty,conflict,updated_at_ms) VALUES(?,?,?,?,0,0,?)
      ON CONFLICT(origin_id,source_id) DO UPDATE SET revision=excluded.revision,
      details_json=CASE WHEN memory_learning.updated_at_ms=? THEN excluded.details_json ELSE memory_learning.details_json END,
      dirty=CASE WHEN memory_learning.updated_at_ms=? THEN 0 ELSE memory_learning.dirty END,
      conflict=CASE WHEN memory_learning.updated_at_ms=? THEN 0 ELSE memory_learning.conflict END,
      remote_json=CASE WHEN memory_learning.updated_at_ms=? THEN NULL ELSE memory_learning.remote_json END
      WHERE memory_learning.revision=?`, learningOrigin(resolved), resolved.sourceId, JSON.stringify(remote.details), remote.revision, snapshot.updatedAtMs, snapshot.updatedAtMs, snapshot.updatedAtMs, snapshot.updatedAtMs, snapshot.updatedAtMs, snapshot.revision)
  })
}

async function preserveConflict(snapshot: MemoryLearningEntry, remote: LearningEnvelope): Promise<void> {
  await withDatabaseTransaction(async database => {
    const resolved = await resolveLearningAlias(database, snapshot.identity)
    await database.runAsync('UPDATE memory_learning SET conflict=1,remote_json=? WHERE origin_id=? AND source_id=? AND revision=?', JSON.stringify(remote), learningOrigin(resolved), resolved.sourceId, snapshot.revision)
  })
}

async function canonicalSnapshot(snapshot: MemoryLearningEntry, remote: LearningEnvelope): Promise<MemoryLearningEntry> {
  if (snapshot.identity.sourceId === remote.sourceId) return snapshot
  const target = { ...snapshot.identity, sourceId: remote.sourceId }
  await withDatabaseTransaction(database => rebindLearningIdentity(database, snapshot.identity, target))
  return memoryLearning(target)
}

async function syncLearningEntry(requester: LearningRequester, identity: MemoryIdentity, recordCanonicalSource: (sourceId: string) => void): Promise<boolean> {
  let snapshot = await memoryLearning(identity)
  if (snapshot.conflict) return true
  let remote = await fetchLearning(requester, snapshot.identity.sourceId)
  snapshot = await canonicalSnapshot(snapshot, remote)
  recordCanonicalSource(snapshot.identity.sourceId)
  if (snapshot.conflict) return true
  if (!snapshot.dirty || JSON.stringify(snapshot.details) === JSON.stringify(remote.details)) {
    await installPulledLearning(snapshot, remote)
    return false
  }
  if (snapshot.revision !== remote.revision) {
    await preserveConflict(snapshot, remote)
    return true
  }
  const response = await requester.request({ method: 'PUT', path: learningPath(remote.sourceId), body: { expectedRevision: snapshot.revision, details: snapshot.details } })
  if (response.status === 409) {
    remote = await fetchLearning(requester, remote.sourceId)
    snapshot = await canonicalSnapshot(snapshot, remote)
    recordCanonicalSource(snapshot.identity.sourceId)
    await preserveConflict(snapshot, remote)
    return true
  }
  const accepted = responseEnvelope(response)
  if (accepted.sourceId !== snapshot.identity.sourceId) {
    const target = { ...snapshot.identity, sourceId: accepted.sourceId }
    await withDatabaseTransaction(database => rebindLearningIdentity(database, snapshot.identity, target))
    snapshot = { ...snapshot, identity: target }
  }
  recordCanonicalSource(snapshot.identity.sourceId)
  await installAcknowledgedLearning(snapshot, accepted)
  return false
}

let syncQueue: Promise<unknown> = Promise.resolve()
const syncOffsets = new Map<string, number>()

function learningRequestBudget(requester: LearningRequester) {
  let requests = 0
  const bounded: LearningRequester = { mailboxId: requester.mailboxId, request: request => {
    if (requests >= 100) throw Object.assign(new Error('Personal note sync will continue on the next refresh'), { code: 'LEARNING_PASS_LIMIT' })
    requests += 1
    return requester.request(request)
  } }
  return { requester: bounded, available: () => requests < 100 }
}

async function synchronizeSourceBatch(requester: LearningRequester, sourceIds: readonly string[]) {
  const budget = learningRequestBudget(requester)
  let conflicts = 0
  let failed = 0
  const visited = new Set<string>()
  const canonicalSourceIds = new Map<string, string>()
  for (const sourceId of sourceIds) {
    if (!budget.available()) break
    try {
      if (await syncLearningEntry(budget.requester, { sourceId, mailboxId: requester.mailboxId }, canonical => { if (canonical !== sourceId) canonicalSourceIds.set(sourceId, canonical) })) conflicts += 1
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'LEARNING_PASS_LIMIT') break
      failed += 1
    }
    visited.add(sourceId)
  }
  return { conflicts, failed, visited, canonicalSourceIds }
}

async function synchronizeLearningPass(requester: LearningRequester, visible: readonly string[]) {
  const database = await openEncryptedDatabase()
  const queued = await database.getAllAsync<{ source_id: string }>('SELECT source_id FROM memory_learning WHERE origin_id=? AND dirty=1 AND conflict=0 ORDER BY updated_at_ms,source_id', requester.mailboxId)
  const sourceIds = [...new Set([...queued.map(source => source.source_id), ...visible])]
  const start = (syncOffsets.get(requester.mailboxId) ?? 0) % Math.max(1, sourceIds.length)
  const sourceBatch = [...sourceIds.slice(start), ...sourceIds.slice(0, start)].slice(0, 100)
  const { conflicts, failed, visited, canonicalSourceIds } = await synchronizeSourceBatch(requester, sourceBatch)
  syncOffsets.set(requester.mailboxId, start + visited.size)
  const remaining = await database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM memory_learning WHERE origin_id=? AND dirty=1 AND conflict=0', requester.mailboxId)
  const unvisitedClean = visible.filter(sourceId => !visited.has(sourceId) && !queued.some(source => source.source_id === sourceId)).length
  return { synced: visited.size - conflicts - failed, conflicts, failed, pending: (remaining?.count ?? 0) + unvisitedClean, canonicalSourceIds }
}

export interface LearningSyncOutcome {
  readonly synced: number
  readonly conflicts: number
  readonly failed: number
  readonly pending: number
  readonly canonicalSourceIds: ReadonlyMap<string, string>
}

export function syncLearningEntries(requester: LearningRequester, sourceIds: readonly string[] = []): Promise<LearningSyncOutcome> {
  const visible = z.array(z.string().uuid()).max(100).parse(sourceIds)
  const pending = syncQueue.then(() => synchronizeLearningPass(requester, visible))
  syncQueue = pending.catch(() => undefined)
  return pending
}

export function synchronizedLearningIdentity(identity: MemoryIdentity, canonicalSourceIds: ReadonlyMap<string, string>): MemoryIdentity {
  let sourceId = identity.sourceId
  for (let followed = 0; followed < canonicalSourceIds.size; followed += 1) {
    const replacement = canonicalSourceIds.get(sourceId)
    if (!replacement) break
    sourceId = replacement
  }
  return { ...identity, sourceId }
}

export async function resolveLearningConflict(identity: MemoryIdentity, choice: 'phone' | 'desktop'): Promise<void> {
  await withDatabaseTransaction(async database => {
    const snapshot = await storedLearningEntry(database, identity)
    if (!snapshot.remote) throw new Error('The Desktop version must be available before resolving this conflict')
    const remote = snapshot.remote
    await database.runAsync('UPDATE memory_learning SET details_json=?,revision=?,dirty=?,conflict=0,remote_json=NULL,updated_at_ms=max(?,updated_at_ms+1) WHERE origin_id=? AND source_id=? AND updated_at_ms=?', JSON.stringify(choice === 'phone' ? snapshot.details : remote.details), remote.revision, choice === 'phone' ? 1 : 0, Date.now(), learningOrigin(snapshot.identity), snapshot.identity.sourceId, snapshot.updatedAtMs)
  })
}
