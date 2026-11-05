import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({ filename: '' }))
vi.mock('expo-secure-store', () => ({ getItemAsync: async () => '0'.repeat(64) }))
vi.mock('expo-file-system/legacy', () => ({ getInfoAsync: async () => ({ exists: false }) }))
vi.mock('expo-file-system', () => ({ File: function File() {}, Paths: { cache: { uri: 'file:///cache/' } } }))
vi.mock('expo-crypto', async () => {
  const crypto = await import('node:crypto')
  return { randomUUID: crypto.randomUUID, CryptoDigestAlgorithm: { SHA256: 'sha256' }, digest: async (_algorithm: string, bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest() }
})
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: async () => (await import('../library/databaseFixture')).sqliteBoundary(storage.filename).openDatabaseAsync() }))

const postUrl = 'https://x.com/writer/status/1234567890123456'
const originalText = 'Original saved post'
const digest = (text: string) => createHash('sha256').update(text).digest('hex')
const database = async () => (await import('../../src/storage/database')).openEncryptedDatabase()
const artifacts = () => import('../../src/sources/artifacts')

async function saveLegacyPost(html: string, metadata: Record<string, unknown> = {}) {
  const sourceId = randomUUID()
  await (await database()).runAsync(`INSERT INTO local_source_artifacts(source_id,operation_key,kind,processing_authority,state,requested_url,final_url,original_sha256,original_bytes,metadata_json,text_content,text_sha256,extractor,extractor_version,extracted_at_ms)
    VALUES(?,?,'url','mobile','ready',?,?,?,?,?,?,?,'legacy','1',1)`, sourceId, randomUUID(), postUrl, postUrl, digest(html), Buffer.from(html), JSON.stringify({ title: 'Saved title', ...metadata }), originalText, digest(originalText))
  return sourceId
}

beforeEach(() => {
  storage.filename = join(mkdtempSync(join(tmpdir(), 'noterel-social-refresh-')), 'notes.db')
  vi.resetModules()
})
afterEach(async () => {
  await (await database()).closeAsync()
  rmSync(join(storage.filename, '..'), { recursive: true, force: true })
})

describe('automatic legacy social-post repair', () => {
  it('keeps an unreadable original and remembers the failure across app restarts', async () => {
    const sourceId = await saveLegacyPost('<html><body>Sign in to X</body></html>')
    const before = await (await artifacts()).localSourceArtifact(sourceId)
    expect(await (await artifacts()).refreshSavedSocialPosts()).toEqual({ cleaned: 0, failed: 1 })
    const after = await (await artifacts()).localSourceArtifact(sourceId)
    expect(after).toEqual({ ...before, metadata: { ...before!.metadata, socialRefreshAttemptVersion: 1 } })
    expect(after!.metadata).not.toHaveProperty('socialContentVersion')
    await (await database()).closeAsync()
    vi.resetModules()
    expect(await (await artifacts()).refreshSavedSocialPosts()).toEqual({ cleaned: 0, failed: 0 })
    expect((await (await artifacts()).localSourceArtifact(sourceId))!.text).toBe(originalText)
  })

  it('repairs usable cached posts while leaving user-edited and delivered posts intact', async () => {
    const sourceId = await saveLegacyPost('<meta property="og:description" content="Recovered post text">')
    const editedId = await saveLegacyPost('<html>Unavailable</html>', { userEditedAtMs: 123 })
    const deliveredId = await saveLegacyPost('<html>Unavailable</html>')
    await (await database()).runAsync('UPDATE local_source_artifacts SET destination_mailbox_id=? WHERE source_id=?', 'desktop-mailbox', deliveredId)
    expect(await (await artifacts()).refreshSavedSocialPosts()).toEqual({ cleaned: 1, failed: 0 })
    const repaired = await (await artifacts()).localSourceArtifact(sourceId)
    expect(repaired!.text).toBe('Recovered post text')
    expect(repaired!.metadata.socialContentVersion).toBe(1)
    for (const protectedId of [editedId, deliveredId]) {
      const preserved = await (await artifacts()).localSourceArtifact(protectedId)
      expect(preserved!.text).toBe(originalText)
      expect(preserved!.metadata).not.toHaveProperty('socialRefreshAttemptVersion')
    }
  })
})
