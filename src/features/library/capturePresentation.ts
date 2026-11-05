import { referenceCapture } from '../../capture/incomingShare'
import type { QueuedCapture } from '../../capture/outbox'
import { captureStatus } from '../../capture/status'
import { safeHttpUrl } from '../../links'
import { t, tm } from '../../i18n'
import type { LocalExtractionProgress, LocalSourceArtifactSummary } from '../../sources/artifacts'
import { captureCopy } from '../capture/captureCopy'
import { videoRecoveryCopy } from '../capture/videoRecoveryCopy'

export function capturePresentation(capture: QueuedCapture, artifact: LocalSourceArtifactSummary | undefined, progress: LocalExtractionProgress | undefined, mailboxId: string | null) {
  const title = artifact?.title || capture.payload.title || (capture.kind === 'url' ? safeHttpUrl(capture.payload.text)?.host ?? t('library.saved_link') : t('common.phone_note'))
  const readableText = artifact?.text || capture.payload.text
  const status = captureAvailability(capture, artifact, progress, mailboxId)
  return { title, readableText, status }
}

function captureAvailability(capture: QueuedCapture, artifact: LocalSourceArtifactSummary | undefined, progress: LocalExtractionProgress | undefined, mailboxId: string | null): string {
  if (artifact?.desktopSourceId) return t('library.on_desktop_phone_copy_retained')
  if (artifact?.state === 'needs_attention') return t('common.send_interrupted_retry_from_menu')
  if (artifact) return t('library.ready_on_this_phone')
  if (capture.destinationMailboxId) return captureStatus(capture, mailboxId)
  if (progress?.state === 'needs_attention') return videoRecoveryCopy('saved')
  if (progress) return `${tm(progress.stage)} · ${progress.percent}%`
  if (referenceCapture(capture.payload)) return captureCopy('referenceStatus')
  return capture.kind === 'url' ? videoRecoveryCopy('saved') : captureStatus(capture, mailboxId)
}
