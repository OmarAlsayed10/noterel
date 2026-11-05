import { sendPendingImage } from './imageImports'
import { desktopOnlyLinkMessage, unreadableImageMessage } from './readability'
import { assignQueuedCapture } from './outbox'
import { drainCaptureOutbox } from './drainOutbox'
import { connectCompanion, currentMailboxId } from '../companion/client'
import { sendLocalSourceArtifact } from '../sources/artifactTransfer'
import { openEncryptedDatabase } from '../storage/database'

export async function deliverProcessedSources(): Promise<number> {
  const mailboxId = await currentMailboxId()
  if (!mailboxId) return 0
  const database = await openEncryptedDatabase()
  const images = await database.getAllAsync<{ id: string }>("SELECT id FROM pending_image_imports WHERE (state='ready' AND text_content<>'' OR state='needs_attention' AND failure_message=?) AND desktop_source_id IS NULL ORDER BY created_at_ms", unreadableImageMessage)
  const pdfs = await database.getAllAsync<{ source_id: string }>("SELECT artifact.source_id FROM local_source_artifacts artifact JOIN pending_pdf_imports pdf ON pdf.id=artifact.source_id WHERE artifact.state='ready' AND artifact.desktop_source_id IS NULL AND artifact.transfer_id IS NULL ORDER BY artifact.extracted_at_ms")
  const links = await database.getAllAsync<{ source_id: string }>("SELECT artifact.source_id FROM local_source_artifacts artifact JOIN outbox_operations capture ON capture.id=artifact.source_id WHERE artifact.state='needs_attention' AND artifact.failure_message=? AND capture.destination_mailbox_id IS NULL", desktopOnlyLinkMessage)
  if (!images.length && !pdfs.length && !links.length) return 0
  const connection = await connectCompanion()
  let delivered = 0
  try {
    for (const image of images) {
      try {
        await sendPendingImage(connection, image.id)
        delivered += 1
      } catch {
        continue
      }
    }
    for (const pdf of pdfs) {
      try {
        await sendLocalSourceArtifact(connection, pdf.source_id, mailboxId)
        delivered += 1
      } catch {
        continue
      }
    }
    if (links.length) {
      for (const link of links) await assignQueuedCapture(link.source_id, mailboxId)
      const result = await drainCaptureOutbox(connection)
      for (const link of links) {
        if (!result.deliveredOperationIds.includes(link.source_id)) continue
        await database.runAsync('DELETE FROM local_source_artifacts WHERE source_id=?', link.source_id)
        delivered += 1
      }
    }
  } finally {
    connection.close()
  }
  return delivered
}
