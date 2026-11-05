import { knowledgeAtlasSchema, type MobileResponse } from '../companion/protocol'
import { openEncryptedDatabase } from '../storage/database'

export type MobileAtlas = ReturnType<typeof knowledgeAtlasSchema.parse>

interface CompanionRequester {
  readonly request: (input: { method: 'GET'; path: string; body: null }) => Promise<MobileResponse>
}

export async function refreshAtlas(requester: CompanionRequester): Promise<MobileAtlas> {
  const response = await requester.request({ method: 'GET', path: '/api/v1/companion/atlas', body: null })
  if (response.status !== 200) throw new Error(`Desktop returned status ${response.status}`)
  const atlas = knowledgeAtlasSchema.parse(response.body)
  const database = await openEncryptedDatabase()
  await database.runAsync('INSERT OR REPLACE INTO atlas_cache(id,snapshot_json,updated_at_ms) VALUES(1,?,?)', JSON.stringify(atlas), Date.now())
  return atlas
}

export async function cachedAtlas(): Promise<{ atlas: MobileAtlas; updatedAtMs: number } | null> {
  const database = await openEncryptedDatabase()
  const row = await database.getFirstAsync<{ snapshot_json: string; updated_at_ms: number }>('SELECT snapshot_json,updated_at_ms FROM atlas_cache WHERE id=1')
  if (!row) return null
  return { atlas: knowledgeAtlasSchema.parse(JSON.parse(row.snapshot_json)), updatedAtMs: row.updated_at_ms }
}
