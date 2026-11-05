import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import * as FileSystem from 'expo-file-system/legacy'
import * as SQLite from 'expo-sqlite'
import { hexadecimal } from '../bytes'
import { createLearningSchema } from './learningSchema'

const databaseKeyName = 'kestrel.database-key.v1'
let databaseKeyRequest: Promise<string> | null = null
let openDatabaseRequest: Promise<SQLite.SQLiteDatabase> | null = null

async function loadDatabaseKey(): Promise<string> {
  const stored = await SecureStore.getItemAsync(databaseKeyName)
  if (stored && !/^[0-9a-f]{64}$/.test(stored)) throw new Error('Stored database key is invalid')
  if (stored) return stored
  const databaseFile = await FileSystem.getInfoAsync(`${SQLite.defaultDatabaseDirectory}/kestrel-mobile.db`)
  if (databaseFile.exists && (databaseFile.size ?? 0) > 0) throw new Error('Encrypted database key is missing')
  const created = hexadecimal(await Crypto.getRandomBytesAsync(32))
  await SecureStore.setItemAsync(databaseKeyName, created)
  return created
}

function databaseKey(): Promise<string> {
  if (databaseKeyRequest) return databaseKeyRequest
  const request = loadDatabaseKey()
  databaseKeyRequest = request.catch(error => {
    databaseKeyRequest = null
    throw error
  })
  return databaseKeyRequest
}

async function createEncryptedDatabase(): Promise<SQLite.SQLiteDatabase> {
  const key = await databaseKey()
  const database = await SQLite.openDatabaseAsync('kestrel-mobile.db')
  try {
    await database.execAsync(`PRAGMA key = '${key}';`)
    const cipher = await database.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version;')
    if (!cipher?.cipher_version) throw new Error('SQLCipher is unavailable')
    const version = await database.getFirstAsync<{ user_version: number }>('PRAGMA user_version;')
    await database.execAsync(`PRAGMA foreign_keys=ON;
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS local_notes (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('note','url')),
        payload_json TEXT NOT NULL,
        payload_bytes INTEGER NOT NULL CHECK(payload_bytes BETWEEN 1 AND 1048576),
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS outbox_operations (
        id TEXT PRIMARY KEY,
        operation_key TEXT NOT NULL UNIQUE,
        destination_mailbox_id TEXT,
        kind TEXT NOT NULL CHECK(kind IN ('note','url')),
        payload_json TEXT NOT NULL,
        payload_bytes INTEGER NOT NULL CHECK(payload_bytes BETWEEN 1 AND 1048576),
        state TEXT NOT NULL CHECK(state IN ('queued','retry_wait','needs_attention')),
        created_at_ms INTEGER NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0 CHECK(retry_count BETWEEN 0 AND 100),
        next_attempt_at_ms INTEGER,
        receipt_json TEXT
      );
      INSERT OR IGNORE INTO local_notes(id,kind,payload_json,payload_bytes,created_at_ms,updated_at_ms)
        SELECT id,kind,payload_json,payload_bytes,created_at_ms,created_at_ms FROM outbox_operations WHERE destination_mailbox_id IS NULL;
      DELETE FROM outbox_operations WHERE destination_mailbox_id IS NULL AND id IN (SELECT id FROM local_notes);
      CREATE TABLE IF NOT EXISTS delivery_receipts (
        id TEXT PRIMARY KEY,
        operation_key TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK(kind IN ('note','url')),
        response_json TEXT NOT NULL,
        delivered_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS downloaded_sources (
        source_id TEXT PRIMARY KEY,
        revision TEXT NOT NULL,
        text_sha256 TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        title TEXT NOT NULL,
        excerpt TEXT NOT NULL,
        text_bytes BLOB NOT NULL,
        byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 0 AND 2097152),
        downloaded_at_ms INTEGER NOT NULL,
        stale INTEGER NOT NULL DEFAULT 0 CHECK(stale IN (0,1)),
        available_revision TEXT,
        pinned INTEGER NOT NULL DEFAULT 1 CHECK(pinned=1)
      );
      CREATE TABLE IF NOT EXISTS download_staging (
        source_id TEXT PRIMARY KEY,
        revision TEXT NOT NULL,
        text_sha256 TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        text_bytes BLOB NOT NULL,
        next_offset INTEGER NOT NULL CHECK(next_offset BETWEEN 0 AND 2097152),
        total_bytes INTEGER NOT NULL CHECK(total_bytes BETWEEN 0 AND 2097152)
      );
      CREATE TABLE IF NOT EXISTS atlas_cache (
        id INTEGER PRIMARY KEY CHECK(id=1),
        snapshot_json TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pending_pdf_imports (
        id TEXT PRIMARY KEY,
        operation_key TEXT NOT NULL UNIQUE,
        destination_mailbox_id TEXT,
        filename TEXT NOT NULL,
        bytes BLOB NOT NULL,
        byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 5 AND 16777216),
        sha256 TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('phone_only','queued','needs_attention')),
        created_at_ms INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pending_image_imports (
        id TEXT PRIMARY KEY,
        operation_key TEXT NOT NULL UNIQUE,
        filename TEXT NOT NULL,
        media_type TEXT NOT NULL CHECK(media_type IN ('image/jpeg','image/png','image/webp')),
        bytes BLOB NOT NULL,
        byte_length INTEGER NOT NULL CHECK(byte_length BETWEEN 12 AND 12582912),
        sha256 TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('queued','processing','ready','needs_attention')),
        text_content TEXT NOT NULL,
        text_sha256 TEXT NOT NULL,
        metadata_json TEXT NOT NULL,
        progress_percent INTEGER NOT NULL CHECK(progress_percent BETWEEN 0 AND 100),
        progress_stage TEXT NOT NULL,
        failure_message TEXT,
        created_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS pending_image_imports_state_idx ON pending_image_imports(state,created_at_ms);
      CREATE TABLE IF NOT EXISTS local_source_artifacts (
        source_id TEXT PRIMARY KEY,
        operation_key TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK(kind IN ('url','video','pdf')),
        processing_authority TEXT NOT NULL CHECK(processing_authority IN ('mobile','desktop')),
        state TEXT NOT NULL CHECK(state IN ('processing','ready','needs_attention')),
        requested_url TEXT,
        final_url TEXT,
        original_sha256 TEXT NOT NULL,
        original_bytes BLOB NOT NULL,
        metadata_json TEXT NOT NULL,
        text_content TEXT NOT NULL,
        text_sha256 TEXT NOT NULL,
        extractor TEXT NOT NULL,
        extractor_version TEXT NOT NULL,
        extracted_at_ms INTEGER NOT NULL,
        destination_mailbox_id TEXT,
        desktop_source_id TEXT,
        receipt_json TEXT
      );
      CREATE INDEX IF NOT EXISTS local_source_artifacts_state_idx ON local_source_artifacts(state,extracted_at_ms DESC);
      CREATE TABLE IF NOT EXISTS local_source_links (
        source_id TEXT NOT NULL,
        related_source_id TEXT NOT NULL,
        score REAL NOT NULL CHECK(score BETWEEN 0 AND 1),
        PRIMARY KEY(source_id,related_source_id),
        CHECK(source_id<related_source_id)
      );
      CREATE TABLE IF NOT EXISTS desktop_note_edits (
        source_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        text_content TEXT NOT NULL,
        project_id TEXT,
        expected_updated_at TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('queued','conflict')),
        updated_at_ms INTEGER NOT NULL
      );`)
    if ((version?.user_version ?? 0) < 7) {
      await database.execAsync(`BEGIN IMMEDIATE;
        ALTER TABLE local_source_artifacts ADD COLUMN transfer_id TEXT;
        ALTER TABLE local_source_artifacts ADD COLUMN transfer_sha256 TEXT;
        ALTER TABLE local_source_artifacts ADD COLUMN transfer_next_offset INTEGER;
        PRAGMA user_version=7;
        COMMIT;`)
    }
    if ((version?.user_version ?? 0) < 8) await database.execAsync('BEGIN IMMEDIATE; DELETE FROM local_source_links; PRAGMA user_version=8; COMMIT;')
    if ((version?.user_version ?? 0) < 9) await database.execAsync(`BEGIN IMMEDIATE;
      ALTER TABLE local_source_artifacts ADD COLUMN progress_percent INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE local_source_artifacts ADD COLUMN progress_stage TEXT NOT NULL DEFAULT 'Waiting to process';
      ALTER TABLE local_source_artifacts ADD COLUMN failure_message TEXT;
      UPDATE local_source_artifacts SET progress_percent=100,progress_stage='Ready' WHERE state='ready';
      PRAGMA user_version=9;
      COMMIT;`)
    if ((version?.user_version ?? 0) < 10) await database.execAsync('PRAGMA user_version=10;')
    if ((version?.user_version ?? 0) < 11) await database.execAsync('BEGIN IMMEDIATE; ALTER TABLE pending_image_imports ADD COLUMN desktop_source_id TEXT; PRAGMA user_version=11; COMMIT;')
    if ((version?.user_version ?? 0) < 12) await database.execAsync(`BEGIN IMMEDIATE;
      ALTER TABLE desktop_note_edits ADD COLUMN destination_mailbox_id TEXT;
      ALTER TABLE downloaded_sources ADD COLUMN mailbox_id TEXT;
      UPDATE desktop_note_edits SET state='conflict';
      PRAGMA user_version=12;
      COMMIT;`)
    if ((version?.user_version ?? 0) < 14) {
      await database.execAsync('BEGIN IMMEDIATE;')
      try { await createLearningSchema(database); await database.execAsync('PRAGMA user_version=14; COMMIT;') } catch (error) { await database.execAsync('ROLLBACK;'); throw error }
    } else await createLearningSchema(database)
    return database
  } catch (error) {
    await database.closeAsync()
    throw error
  }
}

export function openEncryptedDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!openDatabaseRequest) openDatabaseRequest = createEncryptedDatabase().catch(error => {
    openDatabaseRequest = null
    throw error
  })
  return openDatabaseRequest
}

let transactionQueue: Promise<unknown> = Promise.resolve()

export function withDatabaseTransaction<T>(run: (database: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
  const pending = transactionQueue.then(async () => {
    const database = await openEncryptedDatabase()
    let result!: T
    await database.withTransactionAsync(async () => { result = await run(database) })
    return result
  })
  transactionQueue = pending.catch(() => undefined)
  return pending
}
