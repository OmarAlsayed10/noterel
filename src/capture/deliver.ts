import { drainCaptureOutbox } from '../capture/drainOutbox'
import { connectCompanion } from '../companion/client'

export async function deliverQueuedCaptures() {
  const connection = await connectCompanion()
  try {
    return await drainCaptureOutbox(connection)
  } finally {
    connection.close()
  }
}
