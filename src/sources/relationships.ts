import { openEncryptedDatabase, withDatabaseTransaction } from '../storage/database'
import { relationshipScore } from './relationshipRanking'
import type { SQLiteDatabase } from 'expo-sqlite'

interface LocalRelatedSource {
  readonly sourceId: string
  readonly score: number
}

async function relatedSources(database: SQLiteDatabase, sourceId: string, text: string): Promise<readonly LocalRelatedSource[]> {
  const candidates = await database.getAllAsync<{ source_id: string; text_content: string }>(`SELECT * FROM (
      SELECT source_id,substr(text_content,1,2048) AS text_content FROM local_source_artifacts WHERE source_id<>? AND state IN ('ready','needs_attention') AND text_sha256<>'' ORDER BY extracted_at_ms DESC LIMIT 75
    ) UNION ALL SELECT * FROM (
      SELECT id AS source_id,substr(json_extract(payload_json,'$.text'),1,2048) AS text_content FROM local_notes WHERE id<>? AND kind='note' ORDER BY updated_at_ms DESC LIMIT 75
    )`, sourceId, sourceId)
  return candidates.map(candidate => ({ sourceId: candidate.source_id, score: relationshipScore(text, candidate.text_content) })).filter(candidate => candidate.score >= 0.15).sort((left, right) => right.score - left.score || left.sourceId.localeCompare(right.sourceId)).slice(0, 5)
}

async function writeRelationships(database: SQLiteDatabase, sourceId: string, related: readonly LocalRelatedSource[]): Promise<void> {
  await database.runAsync('DELETE FROM local_source_links WHERE source_id=? OR related_source_id=?', sourceId, sourceId)
  for (const candidate of related) {
    const [first, second] = [sourceId, candidate.sourceId].sort()
    await database.runAsync('INSERT OR REPLACE INTO local_source_links(source_id,related_source_id,score) VALUES(?,?,?)', first, second, candidate.score)
  }
}

export async function rebuildLocalRelationships(sourceId: string, text: string): Promise<void> {
  const related = await relatedSources(await openEncryptedDatabase(), sourceId, text)
  await withDatabaseTransaction(database => writeRelationships(database, sourceId, related))
}

export async function rebuildLocalRelationshipsInTransaction(database: SQLiteDatabase, sourceId: string, text: string): Promise<void> {
  await writeRelationships(database, sourceId, await relatedSources(database, sourceId, text))
}

export async function localRelationships(sourceId: string): Promise<readonly LocalRelatedSource[]> {
  const database = await openEncryptedDatabase()
  const rows = await database.getAllAsync<{ source_id: string; related_source_id: string; score: number }>('SELECT source_id,related_source_id,score FROM local_source_links WHERE source_id=? OR related_source_id=? ORDER BY score DESC LIMIT 5', sourceId, sourceId)
  return rows.map(row => ({ sourceId: row.source_id === sourceId ? row.related_source_id : row.source_id, score: row.score }))
}
