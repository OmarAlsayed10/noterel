import { describe, expect, it } from 'vitest'
import { captureStatus } from '../../src/capture/status'

const capture = (destinationMailboxId: string | null, state: 'queued' | 'retry_wait' | 'needs_attention') => ({ destinationMailboxId, state })

describe('capture status', () => {
  it('distinguishes phone-only captures from captures assigned to a Desktop', () => {
    expect(captureStatus(capture(null, 'queued'), 'current')).toBe('Only on this phone')
    expect(captureStatus(capture('current', 'queued'), 'current')).toBe('Waiting for Desktop')
  })

  it('identifies captures assigned to a previous Desktop before retry state', () => {
    expect(captureStatus(capture('previous', 'retry_wait'), 'current')).toBe('Assigned to previous Desktop')
  })

  it('shows actionable delivery states for the current Desktop', () => {
    expect(captureStatus(capture('current', 'retry_wait'), 'current')).toBe('Send interrupted · Retry from menu')
    expect(captureStatus(capture('current', 'needs_attention'), 'current')).toBe('Desktop rejected this capture · Edit or retry')
  })
})
