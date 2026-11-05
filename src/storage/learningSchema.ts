import type { SQLiteDatabase } from 'expo-sqlite'

export async function createLearningSchema(database: SQLiteDatabase): Promise<void> {
  await database.execAsync(`CREATE TABLE IF NOT EXISTS memory_learning (
    origin_id TEXT NOT NULL,
    source_id TEXT NOT NULL,
    details_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
    dirty INTEGER NOT NULL DEFAULT 0 CHECK(dirty IN (0,1)),
    conflict INTEGER NOT NULL DEFAULT 0 CHECK(conflict IN (0,1)),
    remote_json TEXT,
    updated_at_ms INTEGER NOT NULL,
    PRIMARY KEY(origin_id,source_id)
  );
  CREATE INDEX IF NOT EXISTS memory_learning_sync_idx ON memory_learning(origin_id,dirty,updated_at_ms);
  CREATE TABLE IF NOT EXISTS memory_learning_aliases (
    origin_id TEXT NOT NULL CHECK(origin_id<>'phone'),
    source_id TEXT NOT NULL,
    target_source_id TEXT NOT NULL,
    PRIMARY KEY(origin_id,source_id),
    CHECK(source_id<>target_source_id)
  );
  CREATE INDEX IF NOT EXISTS memory_learning_aliases_target_idx ON memory_learning_aliases(origin_id,target_source_id);`)
}
