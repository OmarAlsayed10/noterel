import type { SQLiteDatabase } from 'expo-sqlite'
import { withDatabaseTransaction } from '../storage/database'
import type { MemoryIdentity } from './schema'

export const learningOrigin = (identity: MemoryIdentity): string => identity.mailboxId ?? 'phone'

export async function resolveLearningAlias(database: SQLiteDatabase, identity: MemoryIdentity): Promise<MemoryIdentity> {
  if (!identity.mailboxId) return identity
  let sourceId = identity.sourceId
  const visited = new Set<string>()
  while (!visited.has(sourceId)) {
    visited.add(sourceId)
    const alias = await database.getFirstAsync<{ target_source_id: string }>('SELECT target_source_id FROM memory_learning_aliases WHERE origin_id=? AND source_id=?', identity.mailboxId, sourceId)
    if (!alias) return { ...identity, sourceId }
    sourceId = alias.target_source_id
  }
  throw new Error('Personal note identity contains a replacement cycle')
}

export async function storedMemoryIdentity(database: SQLiteDatabase, identity: MemoryIdentity): Promise<MemoryIdentity> {
  if (identity.mailboxId) return resolveLearningAlias(database, identity)
  const artifact = await database.getFirstAsync<{ desktop_source_id: string | null; destination_mailbox_id: string | null }>('SELECT desktop_source_id,destination_mailbox_id FROM local_source_artifacts WHERE source_id=?', identity.sourceId)
  const bound = artifact?.desktop_source_id && artifact.destination_mailbox_id ? { sourceId: artifact.desktop_source_id, mailboxId: artifact.destination_mailbox_id } : identity
  return resolveLearningAlias(database, bound)
}

export async function recordLearningAlias(database: SQLiteDatabase, previous: MemoryIdentity, target: MemoryIdentity): Promise<void> {
  if (!previous.mailboxId || !target.mailboxId) return
  if (previous.mailboxId !== target.mailboxId) throw new RangeError('Personal notes cannot be reassigned to another Desktop')
  if (previous.sourceId === target.sourceId) return
  await database.runAsync('DELETE FROM memory_learning_aliases WHERE origin_id=? AND source_id=?', target.mailboxId, target.sourceId)
  await database.runAsync('UPDATE memory_learning_aliases SET target_source_id=? WHERE origin_id=? AND target_source_id=?', target.sourceId, previous.mailboxId, previous.sourceId)
  await database.runAsync('INSERT INTO memory_learning_aliases(origin_id,source_id,target_source_id) VALUES(?,?,?) ON CONFLICT(origin_id,source_id) DO UPDATE SET target_source_id=excluded.target_source_id', previous.mailboxId, previous.sourceId, target.sourceId)
}

export function canonicalMemoryIdentity(identity: MemoryIdentity): Promise<MemoryIdentity> {
  return withDatabaseTransaction(database => storedMemoryIdentity(database, identity))
}
