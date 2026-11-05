import { existsSync, mkdtempSync, rmdirSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { SQLiteDatabase } from 'expo-sqlite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileResponse } from '../../src/companion/protocol'

const boundary = vi.hoisted(() => ({ filename: '' }))
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => '0'.repeat(64) }))
vi.mock('expo-file-system/legacy', () => ({ getInfoAsync: async () => ({ exists: false }) }))
vi.mock('expo-crypto', async () => ({ randomUUID: (await import('node:crypto')).randomUUID, CryptoDigestAlgorithm: { SHA256: 'sha256' }, digestStringAsync: async (_algorithm: string, text: string) => createHash('sha256').update(text).digest('hex') }))
vi.mock('expo-sqlite', async () => {
  const { sqliteBoundary } = await import('../library/databaseFixture')
  return { openDatabaseAsync: async () => sqliteBoundary(boundary.filename).openDatabaseAsync() }
})

const sourceId = '00000000-0000-4000-8000-000000000001'
const successorId = '00000000-0000-4000-8000-000000000002'
const laterId = '00000000-0000-4000-8000-000000000003'
const mailboxId = 'a'.repeat(22)
const foreignMailbox = 'b'.repeat(22)
const identity = { sourceId, mailboxId }
const successor = { sourceId: successorId, mailboxId }
const response = (body: unknown, status = 200): MobileResponse => ({ requestId: laterId, status, body })
const modules = async () => ({ ...await import('../../src/learning'), ...await import('../../src/storage/database'), ...await import('../../src/library/library'), ...await import('../../src/library/downloads') })
let database: SQLiteDatabase
let directory: string

async function reopen() {
  await database.closeAsync()
  vi.resetModules()
  const learning = await modules()
  database = await learning.openEncryptedDatabase()
  return learning
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'noterel-learning-identity-'))
  boundary.filename = join(directory, 'notes.db')
  vi.resetModules()
  database = await (await import('../../src/storage/database')).openEncryptedDatabase()
})

afterEach(async () => {
  await database.closeAsync()
  if (!directory.startsWith(join(tmpdir(), 'noterel-learning-identity-'))) throw new Error('Unexpected test database directory')
  for (const suffix of ['', '-wal', '-shm']) if (existsSync(boundary.filename + suffix)) unlinkSync(boundary.filename + suffix)
  rmdirSync(directory)
})

describe('durable personal-note identities', () => {
  it('upgrades a version-13 notebook without losing its personal notes', async () => {
    let learning = await modules()
    await learning.saveMemoryLearning(identity, { ...learning.emptyLearningDetails(), takeaway: 'Existing version thirteen' })
    await database.execAsync('DROP TABLE memory_learning_aliases; PRAGMA user_version=13;')
    learning = await reopen()
    expect(await database.getFirstAsync('PRAGMA user_version;')).toEqual({ user_version: 14 })
    expect((await learning.memoryLearning(identity)).details.takeaway).toBe('Existing version thirteen')
    expect(await database.getAllAsync('SELECT * FROM memory_learning_aliases')).toEqual([])
  })

  it('remembers replacements before personal notes exist and keeps phone and other Desktop origins separate', async () => {
    const learning = await modules()
    await learning.withDatabaseTransaction(connection => learning.rebindLearningIdentity(connection, identity, successor))
    await learning.saveMemoryLearning(identity, { ...learning.emptyLearningDetails(), takeaway: 'Canonical explanation' })
    await learning.saveMemoryLearning({ sourceId, mailboxId: null }, { ...learning.emptyLearningDetails(), takeaway: 'Private phone explanation' })
    await learning.saveMemoryLearning({ sourceId, mailboxId: foreignMailbox }, { ...learning.emptyLearningDetails(), takeaway: 'Foreign explanation' })
    expect(await learning.memoryLearning(identity)).toMatchObject({ identity: successor, details: { takeaway: 'Canonical explanation' } })
    expect((await learning.memoryLearning({ sourceId, mailboxId: null })).details.takeaway).toBe('Private phone explanation')
    expect((await learning.memoryLearning({ sourceId, mailboxId: foreignMailbox })).details.takeaway).toBe('Foreign explanation')
    await expect(learning.withDatabaseTransaction(connection => learning.rebindLearningIdentity(connection, identity, { sourceId: successorId, mailboxId: foreignMailbox }))).rejects.toThrow('another Desktop')
    expect(await database.getAllAsync('SELECT origin_id,source_id,target_source_id FROM memory_learning_aliases')).toEqual([{ origin_id: mailboxId, source_id: sourceId, target_source_id: successorId }])
  })

  it('flattens replacement chains and safely reuses an earlier source identity after a document revert', async () => {
    const learning = await modules()
    await learning.saveMemoryLearning(identity, { ...learning.emptyLearningDetails(), takeaway: 'Keep through revisions' })
    await learning.withDatabaseTransaction(connection => learning.rebindLearningIdentity(connection, identity, successor))
    await learning.withDatabaseTransaction(connection => learning.rebindLearningIdentity(connection, successor, { sourceId: laterId, mailboxId }))
    expect(await database.getAllAsync('SELECT target_source_id FROM memory_learning_aliases')).toEqual([{ target_source_id: laterId }, { target_source_id: laterId }])
    await learning.withDatabaseTransaction(connection => learning.rebindLearningIdentity(connection, { sourceId: laterId, mailboxId }, identity))
    expect(await learning.canonicalMemoryIdentity(successor)).toEqual(identity)
    expect(await learning.memoryLearning({ sourceId: laterId, mailboxId })).toMatchObject({ identity, details: { takeaway: 'Keep through revisions' } })
    expect(await database.getAllAsync('SELECT target_source_id FROM memory_learning_aliases')).toEqual([{ target_source_id: sourceId }, { target_source_id: sourceId }])
    await database.runAsync('INSERT INTO memory_learning_aliases(origin_id,source_id,target_source_id) VALUES(?,?,?)', mailboxId, sourceId, laterId)
    await expect(learning.canonicalMemoryIdentity(identity)).rejects.toThrow('replacement cycle')
    await expect(learning.saveMemoryLearning(identity, learning.emptyLearningDetails())).rejects.toThrow('replacement cycle')
  })

  it('keeps old cached readers attached to canonical notes after failed body download, database reopen, editing and conflict resolution', async () => {
    let learning = await modules()
    const sha = (text: string) => createHash('sha256').update(text).digest('hex')
    const card = (id: string, text: string) => ({ sourceId: id, kind: 'manual_note' as const, title: 'Note', projectId: null, projectName: null, folderName: null, relativePath: null, url: null, revision: sha(`${id}:${text}`), textSha256: sha(text), byteLength: Buffer.byteLength(text), updatedAt: '2026-10-31T10:00:00.000Z', downloadEligible: true, unavailableReason: null })
    const oldCard = card(sourceId, 'Old readable body')
    await learning.downloadSource({ mailboxId, request: async () => response({ ...oldCard, totalBytes: oldCard.byteLength, offset: 0, nextOffset: null, bytes: Buffer.from('Old readable body').toString('base64url') }) }, oldCard)
    await learning.saveMemoryLearning(identity, { ...learning.emptyLearningDetails(), takeaway: 'Personal explanation', collections: ['Study'], revisit: true })
    const sync = { mailboxId, request: async (request: { method: string }) => request.method === 'PUT' ? response({}, 503) : response({ sourceId: successorId, revision: 0, details: learning.emptyLearningDetails() }) }
    expect(await learning.syncLearningEntries(sync, [sourceId])).toMatchObject({ failed: 1 })
    await expect(learning.downloadSource({ mailboxId, request: async () => response({}, 503) }, card(successorId, 'New body'), sourceId)).rejects.toThrow('503')
    expect((await learning.readDownloadedSource(sourceId))?.text).toBe('Old readable body')
    learning = await reopen()
    expect(await learning.memoryLearning(identity)).toMatchObject({ identity: successor, details: { takeaway: 'Personal explanation' } })
    expect(await learning.localLibraryCount('Personal explanation')).toBe(1)
    const filtered = await learning.localLibrary('', 20, 0, { kind: 'all', sinceMs: null, collection: 'Study', revisitOnly: true, source: '' })
    expect(filtered.map(source => source.sourceId)).toEqual([sourceId])
    await learning.saveMemoryLearning(identity, { ...(await learning.memoryLearning(identity)).details, takeaway: 'Edited from old cached reader' })
    await learning.syncLearningEntries({ mailboxId, request: async () => response({ sourceId: successorId, revision: 2, details: { ...learning.emptyLearningDetails(), takeaway: 'Desktop conflict' } }) }, [sourceId])
    expect(await learning.memoryLearning(identity)).toMatchObject({ identity: successor, conflict: true, details: { takeaway: 'Edited from old cached reader' } })
    await learning.resolveLearningConflict(identity, 'desktop')
    expect(await learning.memoryLearning(identity)).toMatchObject({ identity: successor, conflict: false, details: { takeaway: 'Desktop conflict' } })
    expect((await learning.learningIndex()).map(entry => entry.identity.sourceId)).toEqual([successorId])
    await learning.removeDownloadedSource(sourceId)
    expect((await learning.memoryLearning(identity)).details.takeaway).toBe('Desktop conflict')
    await learning.removeMemoryLearning(identity)
    expect(await learning.learningIndex()).toEqual([])
    expect(await database.getAllAsync('SELECT * FROM memory_learning_aliases')).toEqual([])
  })

  it('waits for an identity replacement to commit rather than briefly returning an empty note', async () => {
    const learning = await modules()
    await learning.saveMemoryLearning(identity, { ...learning.emptyLearningDetails(), takeaway: 'Atomic reader text' })
    let release!: () => void
    let started!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const changing = new Promise<void>(resolve => { started = resolve })
    const writer = learning.withDatabaseTransaction(async connection => { await learning.rebindLearningIdentity(connection, identity, successor); started(); await held })
    await changing
    let settled = false
    const reading = learning.memoryLearning(identity).then(entry => { settled = true; return entry })
    await Promise.resolve()
    expect(settled).toBe(false)
    release()
    await writer
    expect(await reading).toMatchObject({ identity: successor, details: { takeaway: 'Atomic reader text' } })
  })

  it('does not resurrect an old hidden record when canonical replacement commits during a metadata GET', async () => {
    const learning = await modules()
    const personal = { ...learning.emptyLearningDetails(), takeaway: 'Synced before replacement' }
    await learning.saveMemoryLearning(identity, personal)
    await learning.syncLearningEntries({ mailboxId, request: async () => response({ sourceId, revision: 1, details: personal }) })
    await learning.syncLearningEntries({ mailboxId, request: async () => {
      await learning.withDatabaseTransaction(connection => learning.rebindLearningIdentity(connection, identity, successor))
      return response({ sourceId, revision: 2, details: { ...personal, takeaway: 'Stale old-source response' } })
    } }, [sourceId])
    expect(await database.getAllAsync('SELECT source_id FROM memory_learning')).toEqual([{ source_id: successorId }])
    expect(await learning.memoryLearning(identity)).toMatchObject({ identity: successor, revision: 1, details: personal })
  })
})
