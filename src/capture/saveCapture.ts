import { memoryLearning, saveMemoryLearning } from '../learning'
import { enqueueCapture, updateQueuedCapture, type QueuedCapture } from './outbox'
import { referenceCapture, type IncomingShare } from './incomingShare'

export async function saveCaptureLocally(payload: IncomingShare, existing?: QueuedCapture): Promise<string> {
  let sourceId: string
  if (existing) { await updateQueuedCapture(existing.id, payload); sourceId = existing.id }
  else sourceId = (await enqueueCapture(payload)).id
  if (payload.takeaway !== undefined && payload.takeaway !== existing?.payload.takeaway && (existing || payload.takeaway.length > 0)) {
    const identity = { sourceId, mailboxId: null }
    const current = await memoryLearning(identity)
    await saveMemoryLearning(identity, { ...current.details, takeaway: payload.takeaway })
  }
  return sourceId
}

export async function prepareCapturedSource(sourceId: string, payload: IncomingShare): Promise<boolean> {
  if (payload.kind !== 'url' || referenceCapture(payload)) return false
  const { queueLocalWebpageProcessing } = await import('../sources/artifacts')
  await queueLocalWebpageProcessing(sourceId, payload.text)
  return true
}
