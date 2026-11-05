import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueuedCapture } from '../../src/capture/outbox'
import { setLanguage, t } from '../../src/i18n'
import { capturePresentation } from '../../src/features/library/capturePresentation'
import { preparationFailureMessage } from '../../src/features/library/preparationFailure'
import { videoRecoveryErrorMessage } from '../../src/features/capture/videoRecoveryError'

vi.mock('react-native', () => ({ Linking: { openURL: vi.fn() } }))

const facebookUrl = 'https://www.facebook.com/share/v/1HWHi6QbX4/'
const legacyCaptionFailure = 'Facebook did not expose post text or captions. Share an audio file here for Whisper transcription, or use Add → Audio on Desktop.'
const capture: QueuedCapture = { id: 'saved-video', operationKey: 'operation', kind: 'url', payload: { kind: 'url', text: facebookUrl, title: 'My video', captureMode: 'extract', takeaway: 'My takeaway' }, destinationMailboxId: null, state: 'queued', createdAtMs: 1, retryCount: 0 }

describe('saved link preparation recovery', () => {
  beforeEach(() => setLanguage('en'))

  it('keeps the failed Facebook video readable as its saved URL', () => {
    const presentation = capturePresentation(capture, undefined, { sourceId: capture.id, state: 'needs_attention', percent: 0, stage: 'Processing failed', failureMessage: legacyCaptionFailure }, null)
    expect(presentation).toMatchObject({ title: 'My video', readableText: facebookUrl })
    expect(presentation.status).toContain('Link saved')
    expect(presentation.status).not.toContain('Ready')
    expect(capture.payload).toMatchObject({ captureMode: 'extract', takeaway: 'My takeaway' })
  })

  it('replaces old caption-only instructions with the available transcription recovery', () => {
    const message = preparationFailureMessage(legacyCaptionFailure)
    expect(message).toContain('transcription options')
    expect(message).not.toContain('Desktop')
    setLanguage('ar')
    expect(preparationFailureMessage(legacyCaptionFailure)).toContain('تحويل الكلام إلى نص')
  })

  it('preserves a different extraction failure instead of claiming captions are missing', () => {
    expect(preparationFailureMessage('Facebook request failed (503)')).toBe('Facebook request failed (503)')
  })

  it('shows safe actionable native failures without exposing URL or JSON diagnostics', () => {
    setLanguage('ar')
    expect(videoRecoveryErrorMessage(new Error('Native bridge: Facebook video preparation timed out'))).toContain('انتهت مهلة')
    expect(videoRecoveryErrorMessage(new Error('Facebook returned HTTP 403'))).toContain('403')
    expect(videoRecoveryErrorMessage(new Error('Native failure {"url":"https://private.example/secret?token=private"}'))).toBeNull()
  })

  it.each([
    ['queued', 'desktop-a', 'common.waiting_for_desktop'],
    ['retry_wait', 'desktop-a', 'common.send_interrupted_retry_from_menu'],
    ['needs_attention', 'desktop-a', 'capture.desktop_rejected_edit_or_retry'],
    ['queued', 'desktop-b', 'capture.assigned_to_previous_desktop']
  ] as const)('keeps %s delivery state visible for the assigned Desktop', (state, currentMailbox, expected) => {
    const assigned: QueuedCapture = { ...capture, state, destinationMailboxId: 'desktop-a', payload: { ...capture.payload, captureMode: 'reference' } }
    const presentation = capturePresentation(assigned, undefined, { sourceId: capture.id, state: 'needs_attention', percent: 0, stage: 'Processing failed', failureMessage: legacyCaptionFailure }, currentMailbox)
    expect(presentation.readableText).toBe(facebookUrl)
    expect(presentation.status).toBe(t(expected))
  })
})
