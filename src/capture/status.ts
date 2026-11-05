import type { QueuedCapture } from './outbox'
import { t } from '../i18n'

export function captureStatus(capture: Pick<QueuedCapture, 'destinationMailboxId' | 'state'>, mailboxId: string | null): string {
  if (capture.destinationMailboxId && mailboxId && capture.destinationMailboxId !== mailboxId) return t('capture.assigned_to_previous_desktop')
  if (!capture.destinationMailboxId) return t('capture.only_on_this_phone')
  if (capture.state === 'needs_attention') return t('capture.desktop_rejected_edit_or_retry')
  if (capture.state === 'retry_wait') return t('common.send_interrupted_retry_from_menu')
  return t('common.waiting_for_desktop')
}
