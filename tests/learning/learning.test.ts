import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MobileResponse } from '../../src/companion/protocol'
import type { LearningDetails } from '../../src/learning/schema'

vi.mock('expo-secure-store', () => ({ getItemAsync: async () => '0'.repeat(64) }))
vi.mock('expo-file-system/legacy', () => ({ getInfoAsync: async () => ({ exists: false }) }))
vi.mock('expo-crypto', async () => ({ randomUUID: (await import('node:crypto')).randomUUID }))
vi.mock('expo-sqlite', async () => (await import('../library/databaseFixture')).sqliteBoundary())
vi.mock('react-native', () => ({ Linking: { openURL: vi.fn() } }))

const sourceId = '00000000-0000-4000-8000-000000000001'
const successorId = '00000000-0000-4000-8000-000000000002'
const annotationId = '00000000-0000-4000-8000-000000000003'
const mailboxId = 'a'.repeat(22)
const identity = { sourceId, mailboxId }
const phone = { sourceId, mailboxId: null }
const response = (body: unknown, status = 200): MobileResponse => ({ requestId: annotationId, status, body })
const details = (takeaway = 'My understanding'): LearningDetails => ({ takeaway, collections: ['Arabic العربية'], revisit: true, annotations: [{ id: annotationId, note: 'شرح الفكرة', quote: 'original passage', startMs: null, createdAtMs: 100 }] })
const modules = async () => ({ ...await import('../../src/learning'), ...await import('../../src/storage/database') })

beforeEach(() => vi.resetModules())
afterEach(async () => { const { openEncryptedDatabase } = await import('../../src/storage/database'); await (await openEncryptedDatabase()).closeAsync() })

describe('source-linked personal learning', () => {
  it.each(['network', 'server'] as const)('keeps the canonical reader identity when the following PUT fails at the %s boundary', async failure => {
    const learning = await modules()
    await learning.saveMemoryLearning(identity, details('Reader draft'))
    const outcome = await learning.syncLearningEntries({ mailboxId, request: async request => {
      if (request.method === 'GET') return response({ sourceId: successorId, revision: 0, details: learning.emptyLearningDetails() })
      if (failure === 'network') throw new Error('Wireless disconnected')
      return response({}, 503)
    } }, [sourceId])
    expect(outcome.failed).toBe(1)
    const active = learning.synchronizedLearningIdentity(identity, outcome.canonicalSourceIds)
    expect(active).toEqual({ sourceId: successorId, mailboxId })
    expect(await learning.memoryLearning(active)).toMatchObject({ details: details('Reader draft'), dirty: true })
    await learning.saveMemoryLearning(active, details('Continued reader edit'))
    expect((await learning.learningIndex()).map(entry => entry.identity.sourceId)).toEqual([successorId])
  })

  it('persists takeaways, collections, revisit and annotations separately for phone and Desktop origins', async () => {
    const learning = await modules()
    await learning.saveMemoryLearning(phone, details('Phone private text'))
    await learning.saveMemoryLearning(identity, details('Desktop-bound text'))
    expect(await learning.memoryLearning(phone)).toMatchObject({ identity: phone, details: details('Phone private text'), dirty: true })
    expect(await learning.memoryLearning(identity)).toMatchObject({ details: details('Desktop-bound text') })
    expect(await learning.learningIndex()).toHaveLength(2)
    await expect(learning.saveMemoryLearning(phone, details('ع'.repeat(4097)))).rejects.toThrow()
    expect((await learning.memoryLearning(phone)).details.takeaway).toBe('Phone private text')
  })

  it('merges personal notes during canonical installation without losing colliding annotation edits', async () => {
    const learning = await modules()
    await learning.saveMemoryLearning(phone, details('Phone takeaway'))
    await learning.saveMemoryLearning(identity, { ...details('Desktop takeaway'), annotations: [{ ...details().annotations[0], note: 'Another explanation' }] })
    await learning.withDatabaseTransaction(database => learning.rebindLearningIdentity(database, phone, identity))
    const rebound = await learning.memoryLearning(identity)
    expect(rebound.details.takeaway).toContain('Phone takeaway')
    expect(rebound.details.takeaway).toContain('Desktop takeaway')
    expect(rebound.details.annotations.map(annotation => annotation.note).sort()).toEqual(['Another explanation', 'شرح الفكرة'].sort())
    expect(new Set(rebound.details.annotations.map(annotation => annotation.id)).size).toBe(2)
    expect(rebound.details.collections).toEqual(['Arabic العربية'])
    expect(await learning.learningIndex()).toHaveLength(1)
    await expect(learning.withDatabaseTransaction(database => learning.rebindLearningIdentity(database, identity, { ...identity, mailboxId: 'b'.repeat(22) }))).rejects.toThrow('another Desktop')
    expect((await learning.memoryLearning(identity)).details.annotations).toHaveLength(2)
  })

  it('syncs only entries bound to the connected Desktop and never sends phone-only or foreign data', async () => {
    const learning = await modules()
    await learning.saveMemoryLearning(phone, details('Private phone text'))
    await learning.saveMemoryLearning({ sourceId: successorId, mailboxId: 'b'.repeat(22) }, details('Foreign Desktop text'))
    await learning.saveMemoryLearning(identity, details('Intended Desktop text'))
    const requests: unknown[] = []
    const requester = { mailboxId, request: async (request: { method: string; body: unknown }) => {
      requests.push(request)
      return response({ sourceId, revision: request.method === 'PUT' ? 1 : 0, details: request.method === 'PUT' ? details('Intended Desktop text') : learning.emptyLearningDetails() })
    } }
    expect(await learning.syncLearningEntries(requester)).toEqual({ synced: 1, conflicts: 0, failed: 0, pending: 0, canonicalSourceIds: new Map() })
    expect(JSON.stringify(requests)).not.toContain('Private phone text')
    expect(JSON.stringify(requests)).not.toContain('Foreign Desktop text')
    expect(await learning.memoryLearning(identity)).toMatchObject({ dirty: false, revision: 1 })
    expect((await learning.memoryLearning(phone)).dirty).toBe(true)
  })

  it.each(['phone', 'desktop'] as const)('retains both versions on a revision conflict until explicit %s resolution', async choice => {
    const learning = await modules()
    await learning.saveMemoryLearning(identity, details('Phone edit'))
    const requester = { mailboxId, request: vi.fn(async () => response({ sourceId, revision: 2, details: details('Desktop edit') })) }
    expect(await learning.syncLearningEntries(requester)).toMatchObject({ conflicts: 1 })
    expect(requester.request).toHaveBeenCalledTimes(1)
    expect(await learning.memoryLearning(identity)).toMatchObject({ details: details('Phone edit'), conflict: true, remote: { details: details('Desktop edit') } })
    await learning.resolveLearningConflict(identity, choice)
    expect(await learning.memoryLearning(identity)).toMatchObject({ details: details(choice === 'phone' ? 'Phone edit' : 'Desktop edit'), revision: 2, dirty: choice === 'phone', conflict: false, remote: null })
  })

  it('recovers a lost save acknowledgment without resending or marking the accepted edit as conflicting', async () => {
    const learning = await modules()
    await learning.saveMemoryLearning(identity, details())
    let accepted = false
    let puts = 0
    const requester = { mailboxId, request: async (request: { method: string }) => {
      if (request.method === 'PUT') { puts += 1; accepted = true; throw new Error('Acknowledgment lost') }
      return response({ sourceId, revision: accepted ? 1 : 0, details: accepted ? details() : learning.emptyLearningDetails() })
    } }
    expect(await learning.syncLearningEntries(requester)).toMatchObject({ failed: 1 })
    expect((await learning.memoryLearning(identity)).dirty).toBe(true)
    expect(await learning.syncLearningEntries(requester)).toMatchObject({ synced: 1, failed: 0 })
    expect(puts).toBe(1)
    expect(await learning.memoryLearning(identity)).toMatchObject({ dirty: false, conflict: false, revision: 1 })
  })

  it('retains the phone edit when Desktop changes between the revision read and the save', async () => {
    const learning = await modules()
    await learning.saveMemoryLearning(identity, details('Phone edit'))
    let raced = false
    const requester = { mailboxId, request: async (request: { method: string }) => {
      if (request.method === 'PUT') { raced = true; return response({}, 409) }
      return response({ sourceId, revision: raced ? 2 : 0, details: raced ? details('Racing Desktop edit') : learning.emptyLearningDetails() })
    } }
    expect(await learning.syncLearningEntries(requester)).toMatchObject({ conflicts: 1, failed: 0 })
    expect(await learning.memoryLearning(identity)).toMatchObject({ details: details('Phone edit'), dirty: true, conflict: true, remote: { revision: 2, details: details('Racing Desktop edit') } })
  })

  it('resolves a retained phone artifact through its explicit Desktop transfer identity', async () => {
    const learning = await modules()
    const database = await learning.openEncryptedDatabase()
    await database.runAsync(`INSERT INTO local_source_artifacts(source_id,operation_key,kind,processing_authority,state,original_sha256,original_bytes,metadata_json,text_content,text_sha256,extractor,extractor_version,extracted_at_ms,destination_mailbox_id,desktop_source_id)
      VALUES(?,?,'url','mobile','ready',?,?,?,'Original',?,'test','1',1,?,?)`, sourceId, sourceId, 'a'.repeat(64), new Uint8Array([1]), '{}', 'b'.repeat(64), mailboxId, successorId)
    expect(await learning.canonicalMemoryIdentity(phone)).toEqual({ sourceId: successorId, mailboxId })
    expect(await learning.canonicalMemoryIdentity({ sourceId: annotationId, mailboxId: null })).toEqual({ sourceId: annotationId, mailboxId: null })
  })

  it.each([sourceId, successorId])('preserves a newer local edit while the previous save returns canonical source %s', async acceptedSourceId => {
    const learning = await modules()
    await learning.saveMemoryLearning(identity, details('Dispatched edit'))
    const requester = { mailboxId, request: async (request: { method: string }) => {
      if (request.method === 'PUT') { await learning.saveMemoryLearning(identity, details('Newer draft')); return response({ sourceId: acceptedSourceId, revision: 1, details: details('Dispatched edit') }) }
      return response({ sourceId, revision: 0, details: learning.emptyLearningDetails() })
    } }
    const outcome = await learning.syncLearningEntries(requester)
    const active = learning.synchronizedLearningIdentity(identity, outcome.canonicalSourceIds)
    expect(active.sourceId).toBe(acceptedSourceId)
    const loaded = await learning.memoryLearning(active)
    expect(loaded).toMatchObject({ details: details('Newer draft'), dirty: true, revision: 1 })
    await learning.saveMemoryLearning(loaded.identity, details('Edited in the same reader'))
    expect((await learning.learningIndex()).map(entry => entry.identity.sourceId)).toEqual([acceptedSourceId])
  })

  it('keeps the original revision when local editing overlaps a clean GET so the later sync preserves both versions', async () => {
    const learning = await modules()
    await learning.saveMemoryLearning(identity, details('Synced revision one'))
    await learning.syncLearningEntries({ mailboxId, request: async () => response({ sourceId, revision: 1, details: details('Synced revision one') }) })
    let edited = false
    const methods: string[] = []
    const requester = { mailboxId, request: async (request: { method: string }) => {
      methods.push(request.method)
      if (request.method !== 'GET') throw new Error('A concurrent phone edit must not overwrite revision two')
      if (!edited) { edited = true; await learning.saveMemoryLearning(identity, details('Concurrent phone draft')) }
      return response({ sourceId, revision: 2, details: details('Desktop revision two') })
    } }
    await learning.syncLearningEntries(requester, [sourceId])
    expect(await learning.memoryLearning(identity)).toMatchObject({ revision: 1, dirty: true, details: details('Concurrent phone draft') })
    expect(await learning.syncLearningEntries(requester, [sourceId])).toMatchObject({ conflicts: 1, failed: 0 })
    expect(methods).toEqual(['GET', 'GET'])
    expect(await learning.memoryLearning(identity)).toMatchObject({ revision: 1, conflict: true, details: details('Concurrent phone draft'), remote: { revision: 2, details: details('Desktop revision two') } })
  })

  it('retains unavailable personal notes while continuing independent entries after a 404', async () => {
    const learning = await modules()
    await learning.saveMemoryLearning(identity, details('Unavailable retained note'))
    await learning.saveMemoryLearning({ sourceId: successorId, mailboxId }, details('Still available'))
    const requester = { mailboxId, request: async (request: { path: string; method: string }) => request.path.endsWith(sourceId) ? response({}, 404) : response({ sourceId: successorId, revision: request.method === 'PUT' ? 1 : 0, details: request.method === 'PUT' ? details('Still available') : learning.emptyLearningDetails() }) }
    expect(await learning.syncLearningEntries(requester)).toEqual({ synced: 1, conflicts: 0, failed: 1, pending: 1, canonicalSourceIds: new Map() })
    expect(await learning.memoryLearning(identity)).toMatchObject({ details: details('Unavailable retained note'), dirty: true })
    expect(await learning.memoryLearning({ sourceId: successorId, mailboxId })).toMatchObject({ dirty: false, revision: 1 })
  })

  it('pulls a canonical successor without manufacturing a conflict for unchanged local metadata', async () => {
    const learning = await modules()
    await learning.saveMemoryLearning(identity, details('Previously synced'))
    await learning.syncLearningEntries({ mailboxId, request: async () => response({ sourceId, revision: 1, details: details('Previously synced') }) })
    const requester = { mailboxId, request: vi.fn(async () => response({ sourceId: successorId, revision: 2, details: details('Desktop latest') })) }
    const outcome = await learning.syncLearningEntries(requester, [sourceId])
    expect(requester.request).toHaveBeenCalledTimes(1)
    expect(await learning.memoryLearning({ sourceId: successorId, mailboxId })).toMatchObject({ details: details('Desktop latest'), dirty: false, conflict: false, revision: 2 })
    expect((await learning.learningIndex()).map(entry => entry.identity.sourceId)).toEqual([successorId])
    const active = learning.synchronizedLearningIdentity(identity, outcome.canonicalSourceIds)
    const loaded = await learning.memoryLearning(active)
    expect(loaded.identity).toEqual({ sourceId: successorId, mailboxId })
    await learning.saveMemoryLearning(loaded.identity, details('Reader edit after canonical GET'))
    expect((await learning.learningIndex()).map(entry => entry.identity.sourceId)).toEqual([successorId])
  })

  it('anchors only to actual passages and supplied source moments and preserves stale annotations as unavailable', async () => {
    const { assertAnnotationAnchor, annotationAvailable, annotationSourceUrl } = await import('../../src/learning/anchors')
    const annotation = { ...details().annotations[0], startMs: 5000 }
    const segments = [{ startMs: 5000, endMs: 9000, startByte: 0, endByte: 16 }]
    expect(() => assertAnnotationAnchor(annotation, 'The original passage is here', segments)).not.toThrow()
    expect(() => assertAnnotationAnchor({ ...annotation, startMs: 6000 }, 'original passage', segments)).toThrow('available video moment')
    expect(annotationAvailable(annotation, 'This source changed', segments)).toBe(false)
    expect(annotationAvailable(annotation, 'original passage and original passage', segments)).toBe(false)
    expect(annotationSourceUrl('https://www.youtube.com/watch?v=abcdefghijk', 5000)).toContain('t=5s')
    expect(annotationSourceUrl('javascript:alert(1)', 5000)).toBeNull()
    expect(annotationSourceUrl('https://www.tiktok.com/@test/video/123', 5000)).toBeNull()
  })

  it('bounds sync requests and advances past unavailable entries on a later refresh', async () => {
    const learning = await modules()
    for (let index = 1; index <= 101; index += 1) await learning.saveMemoryLearning({ sourceId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, mailboxId }, details())
    const requests: string[] = []
    const requester = { mailboxId, request: async (request: { path: string }) => { requests.push(request.path); return response({}, 404) } }
    expect(await learning.syncLearningEntries(requester)).toMatchObject({ failed: 100, pending: 101 })
    expect(requests).toHaveLength(100)
    const later = `00000000-0000-4000-8000-${String(101).padStart(12, '0')}`
    expect(requests.some(path => path.endsWith(later))).toBe(false)
    requests.length = 0
    await learning.syncLearningEntries(requester)
    expect(requests).toHaveLength(100)
    expect(requests[0]).toContain(later)
    expect(await learning.learningIndex()).toHaveLength(101)
  })
})
