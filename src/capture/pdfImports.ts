import * as Crypto from 'expo-crypto'
import { File } from 'expo-file-system'
import { openEncryptedDatabase, withDatabaseTransaction } from '../storage/database'
import type { MobileResponse } from '../companion/protocol'
import { base64Url, hexadecimal } from '../bytes'

const maximumPdfStorageBytes = 32 * 1024 * 1024
const pdfOcrTimeoutMilliseconds = 5 * 60 * 1000

export interface PdfCandidate {
  readonly uri: string
  readonly filename: string
  readonly size: number
}

export interface PendingPdf {
  readonly id: string
  readonly operationKey: string
  readonly destinationMailboxId: string | null
  readonly filename: string
  readonly byteLength: number
  readonly state: 'phone_only' | 'queued' | 'needs_attention'
}

interface CompanionRequester {
  readonly request: (input: { method: 'PUT' | 'POST'; path: string; body: unknown }, responseTimeoutMilliseconds?: number) => Promise<MobileResponse>
}

export async function savePendingPdf(candidate: PdfCandidate): Promise<PendingPdf> {
  const bytes = new Uint8Array(await new File(candidate.uri).arrayBuffer())
  if (bytes.byteLength !== candidate.size || bytes.byteLength < 5 || new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new RangeError('The selected file is not a valid PDF')
  const id = Crypto.randomUUID()
  const operationKey = Crypto.randomUUID()
  await withDatabaseTransaction(async database => {
    const usage = await database.getFirstAsync<{ bytes: number }>('SELECT coalesce(sum(byte_length),0) AS bytes FROM pending_pdf_imports')
    if (!usage || usage.bytes + bytes.byteLength > maximumPdfStorageBytes) throw new RangeError('Pending PDF storage is full')
    const digest = hexadecimal(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes))
    await database.runAsync("INSERT INTO pending_pdf_imports(id,operation_key,destination_mailbox_id,filename,bytes,byte_length,sha256,state,created_at_ms) VALUES(?,?,?,?,?,?,?,'phone_only',?)", id, operationKey, null, candidate.filename, bytes, bytes.byteLength, digest, Date.now())
  })
  return { id, operationKey, destinationMailboxId: null, filename: candidate.filename, byteLength: bytes.byteLength, state: 'phone_only' }
}

export async function pendingPdfCount(): Promise<number> {
  const database = await openEncryptedDatabase()
  const row = await database.getFirstAsync<{ count: number }>('SELECT count(*) AS count FROM pending_pdf_imports')
  return row?.count ?? 0
}

export async function pendingPdfs(query = '', limit = 20, offset = 0): Promise<readonly PendingPdf[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(offset) || offset < 0) throw new RangeError('Phone PDF page is invalid')
  const database = await openEncryptedDatabase()
  const rows = await database.getAllAsync<{ id: string; operation_key: string; destination_mailbox_id: string | null; filename: string; byte_length: number; state: PendingPdf['state'] }>(`SELECT pdf.id,pdf.operation_key,pdf.destination_mailbox_id,pdf.filename,pdf.byte_length,pdf.state FROM pending_pdf_imports pdf
    LEFT JOIN local_source_artifacts artifact ON artifact.source_id=pdf.id
    WHERE ?='' OR instr(lower(pdf.filename || ' ' || coalesce(artifact.text_content,'')),lower(?))>0
    ORDER BY pdf.created_at_ms DESC,pdf.id DESC LIMIT ? OFFSET ?`, query, query, limit, offset)
  return rows.map(row => ({ id: row.id, operationKey: row.operation_key, destinationMailboxId: row.destination_mailbox_id, filename: row.filename, byteLength: row.byte_length, state: row.state }))
}

export async function discardPendingPdf(id: string): Promise<void> {
  await withDatabaseTransaction(async database => {
    await database.runAsync('DELETE FROM local_source_links WHERE source_id=? OR related_source_id=?', id, id)
    await database.runAsync('DELETE FROM local_source_artifacts WHERE source_id=?', id)
    await database.runAsync('DELETE FROM pending_pdf_imports WHERE id=?', id)
  })
}

export async function sendPendingPdf(requester: CompanionRequester, id: string, mailboxId: string): Promise<void> {
  const database = await openEncryptedDatabase()
  try {
    const pdf = await database.getFirstAsync<{ operation_key: string; filename: string; bytes: Uint8Array; byte_length: number; sha256: string }>('SELECT operation_key,filename,bytes,byte_length,sha256 FROM pending_pdf_imports WHERE id=?', id)
    if (!pdf) throw new Error('Pending PDF is unavailable')
    await database.runAsync("UPDATE pending_pdf_imports SET destination_mailbox_id=?,state='queued' WHERE id=?", mailboxId, id)
    const started = await requester.request({ method: 'PUT', path: `/api/v1/companion/pdf-imports/${id}`, body: { operationKey: pdf.operation_key, filename: pdf.filename, totalBytes: pdf.byte_length, sha256: pdf.sha256 } })
    if (started.status !== 200) throw new Error(`Desktop returned status ${started.status}`)
    for (let offset = 0; offset < pdf.byte_length; offset += 24 * 1024) {
      const endOffset = Math.min(offset + 24 * 1024, pdf.byte_length)
      const responseTimeout = endOffset === pdf.byte_length ? pdfOcrTimeoutMilliseconds : undefined
      const response = await requester.request({ method: 'POST', path: `/api/v1/companion/pdf-imports/${id}/chunks`, body: { offset, bytes: base64Url(pdf.bytes.subarray(offset, endOffset)) } }, responseTimeout)
      if (response.status < 200 || response.status >= 300) throw new Error(`Desktop returned status ${response.status}`)
    }
    await database.runAsync('DELETE FROM pending_pdf_imports WHERE id=?', id)
  } catch (error) {
    await database.runAsync("UPDATE pending_pdf_imports SET state='needs_attention' WHERE id=?", id)
    throw error
  }
}
