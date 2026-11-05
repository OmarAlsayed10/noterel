import type { SQLiteDatabase } from 'expo-sqlite'
import type { IncomingShare } from './incomingShare'

const maximumOperationPayloadBytes = 1024 * 1024
export const maximumCaptureStorageBytes = 10 * 1024 * 1024

export function encodeCapturePayload(payload: IncomingShare): { payloadJson: string; payloadBytes: number } {
  const payloadJson = JSON.stringify(payload)
  const payloadBytes = new TextEncoder().encode(payloadJson).byteLength
  if (payloadBytes > maximumOperationPayloadBytes) throw new RangeError('Capture is too large')
  return { payloadJson, payloadBytes }
}

export async function captureStorageUsage(database: SQLiteDatabase): Promise<{ bytes: number }> {
  const usage = await database.getFirstAsync<{ bytes: number }>(`SELECT
    (SELECT coalesce(sum(payload_bytes),0) FROM local_notes)+(SELECT coalesce(sum(payload_bytes),0) FROM outbox_operations WHERE id NOT IN (SELECT id FROM local_notes)) AS bytes`)
  if (!usage) throw new Error('Phone note storage is unavailable')
  return usage
}
