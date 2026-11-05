import { z } from 'zod'
import type { MobileResponse } from '../companion/protocol'
import { canonicalMemoryIdentity } from '../learning'
import { eraseDesktopCopies } from './eraseDesktopCopies'

interface CompanionRequester {
  readonly mailboxId: string
  readonly request: (input: { method: 'DELETE'; path: string; body: null }) => Promise<MobileResponse>
}

const deletionResponseSchema = z.object({ sourceId: z.string().uuid(), state: z.literal('deleted') }).strict()

export async function deleteDesktopMemory(requester: CompanionRequester, sourceId: string): Promise<void> {
  const canonical = await canonicalMemoryIdentity({ sourceId, mailboxId: requester.mailboxId })
  const response = await requester.request({ method: 'DELETE', path: `/api/v1/sources/${canonical.sourceId}`, body: null })
  if (response.status < 200 || response.status >= 300) throw new Error(`Desktop returned status ${response.status}`)
  const receipt = deletionResponseSchema.parse(response.body)
  if (receipt.sourceId !== canonical.sourceId) throw new Error('Desktop returned a different deleted source')
  await eraseDesktopCopies({ sourceId: canonical.sourceId, mailboxId: requester.mailboxId })
}
