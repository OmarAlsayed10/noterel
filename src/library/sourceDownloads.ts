import { libraryCardSchema, libraryPageSchema } from '../companion/protocol'
import { appendSourcePage, beginSourceDownload, finishSourceDownload } from './downloads'
import { currentDesktopCard, desktopLibraryBody, type DesktopLibraryRequester } from './desktopLibrary'
import type { z } from 'zod'

async function downloadSourceRevision(requester: DesktopLibraryRequester, card: z.infer<typeof libraryCardSchema>, replacesSourceId: string) {
  let offset = await beginSourceDownload(card, replacesSourceId, requester.mailboxId)
  while (offset !== null) {
    const response = await requester.request({ method: 'GET', path: `/api/v1/companion/library/${card.sourceId}?revision=${card.revision}&offset=${offset}`, body: null })
    if (response.status === 409 || response.status === 404) throw Object.assign(new Error('Desktop source changed during download'), { code: 'DOWNLOAD_REVISION_CONFLICT' })
    const page = libraryPageSchema.parse(desktopLibraryBody(response))
    if (page.sourceId !== card.sourceId) throw new Error('Desktop returned a different source')
    offset = await appendSourcePage(page)
  }
  await finishSourceDownload(card.sourceId, replacesSourceId, requester.mailboxId)
}

let downloadQueue: Promise<unknown> = Promise.resolve()

export function downloadSource(requester: DesktopLibraryRequester, cardInput: unknown, replacesSourceId?: string): Promise<void> {
  const card = libraryCardSchema.parse(cardInput)
  const previousSourceId = replacesSourceId ?? card.sourceId
  const pending = downloadQueue.then(async () => {
    try {
      await downloadSourceRevision(requester, card, previousSourceId)
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'DOWNLOAD_REVISION_CONFLICT') throw error
      await downloadSourceRevision(requester, await currentDesktopCard(requester, card.sourceId), previousSourceId)
    }
  })
  downloadQueue = pending.catch(() => undefined)
  return pending
}

export async function refreshDownloadedSource(requester: DesktopLibraryRequester, sourceId: string, replacement = sourceId): Promise<void> {
  const card = await currentDesktopCard(requester, replacement)
  await downloadSource(requester, card, sourceId)
}
