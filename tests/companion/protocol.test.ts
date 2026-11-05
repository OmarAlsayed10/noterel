import { describe, expect, it } from 'vitest'
import { knowledgeAtlasSchema, libraryCheckSchema, libraryListingSchema, libraryPageSchema, mobileRequestSchema, pairingPayloadSchema, pairingQrSchema, parsePairingQr } from '../../src/companion/protocol'

const validQr = {
  protocolVersion: 1,
  relayUrl: 'https://relay.example/',
  mailboxId: 'abcdefghijklmnopqrstuv',
  relayTicket: 't'.repeat(80),
  desktopPublicKey: `${'a'.repeat(42)}A`,
  pairingId: '123e4567-e89b-42d3-a456-426614174000',
  pairingSecret: `${'b'.repeat(42)}Q`,
  expiresAt: '2026-09-05T12:00:00.000Z'
}

describe('companion protocol input', () => {
  it.each([
    ['unsupported protocol version', { ...validQr, protocolVersion: 2 }],
    ['cleartext relay', { ...validQr, relayUrl: 'http://relay.example/' }],
    ['relay credentials', { ...validQr, relayUrl: 'https://owner:secret@relay.example/' }],
    ['relay query', { ...validQr, relayUrl: 'https://relay.example/?mailbox=one' }],
    ['wrong key length', { ...validQr, desktopPublicKey: 'a'.repeat(42) }],
    ['noncanonical key', { ...validQr, desktopPublicKey: 'a'.repeat(43) }],
    ['unknown field', { ...validQr, modelToken: 'secret' }]
  ])('rejects %s in a pairing QR', (_scenario, qr) => {
    expect(pairingQrSchema.safeParse(qr).success).toBe(false)
  })

  it('accepts every canonical 32-byte Base64URL ending', () => {
    for (const ending of 'AEIMQUYcgkosw048') {
      const qr = { ...validQr, desktopPublicKey: `${'a'.repeat(42)}${ending}` }
      expect(parsePairingQr(qr, Date.parse(validQr.expiresAt) - 1)).toEqual(qr)
    }
  })

  it('rejects an expired pairing QR at its exact boundary', () => {
    expect(() => parsePairingQr(validQr, Date.parse(validQr.expiresAt))).toThrow('expired')
    expect(() => parsePairingQr(validQr, Date.parse(validQr.expiresAt) + 1)).toThrow('expired')
  })

  it('bounds the pairing display name by UTF-8 bytes', () => {
    const payload = { pairingId: validQr.pairingId, pairingSecret: validQr.pairingSecret, displayName: 'é'.repeat(128) }
    expect(pairingPayloadSchema.safeParse(payload).success).toBe(true)
    expect(pairingPayloadSchema.safeParse({ ...payload, displayName: `${payload.displayName}é` }).success).toBe(false)
  })

  it('pins bounded library page and reconciliation contracts', () => {
    const page = {
      sourceId: validQr.pairingId,
      kind: 'manual_note',
      title: 'Offline note',
      projectId: null,
      projectName: null,
      url: null,
      revision: 'a'.repeat(64),
      textSha256: 'b'.repeat(64),
      byteLength: 5,
      updatedAt: validQr.expiresAt,
      downloadEligible: true,
      unavailableReason: null,
      totalBytes: 5,
      offset: 0,
      nextOffset: null,
      bytes: 'aGVsbG8'
    }
    expect(libraryPageSchema.safeParse(page).success).toBe(true)
    expect(libraryPageSchema.safeParse({ ...page, title: 'é'.repeat(257) }).success).toBe(false)
    expect(libraryPageSchema.safeParse({ ...page, bytes: 'a'.repeat(32_769) }).success).toBe(false)
    const { totalBytes: _totalBytes, offset: _offset, nextOffset: _nextOffset, bytes: _bytes, ...card } = page
    expect(libraryListingSchema.safeParse({ items: [card], nextCursor: 'canonical_cursor', totalItems: 200 }).success).toBe(true)
    expect(libraryListingSchema.safeParse({ items: Array(51).fill(card), nextCursor: null, totalItems: 51 }).success).toBe(false)
    expect(libraryCheckSchema.safeParse([{ sourceId: validQr.pairingId, state: 'changed', revision: 'c'.repeat(64) }]).success).toBe(true)
    expect(libraryCheckSchema.safeParse([{ sourceId: validQr.pairingId, state: 'unavailable', revision: 'c'.repeat(64) }]).success).toBe(false)
  })

  it('accepts bounded note updates and rejects capabilities outside the transport contract', () => {
    const request = { version: 1, requestId: validQr.pairingId, issuedAtMs: 1, method: 'PATCH', path: '/api/v1/notes', body: null }
    expect(mobileRequestSchema.safeParse({ ...request, method: 'PUT', path: `/api/v1/notes/${validQr.pairingId}`, body: {} }).success).toBe(true)
    expect(mobileRequestSchema.safeParse(request).success).toBe(false)
    expect(mobileRequestSchema.safeParse({ ...request, method: 'GET', path: '/internal/companion/devices' }).success).toBe(false)
    expect(mobileRequestSchema.safeParse({ ...request, method: 'GET', path: '/api/v1/notes', headers: { authorization: 'secret' } }).success).toBe(false)
  })

  it('bounds Desktop atlas snapshots', () => {
    const node = { id: validQr.pairingId, kind: 'source', subjectId: validQr.pairingId, sourceId: validQr.pairingId, label: 'Note', summary: 'Note', sourceKind: 'manual_note' }
    expect(knowledgeAtlasSchema.safeParse({ nodes: [node], edges: [], totalSources: 1, truncated: false }).success).toBe(true)
    expect(knowledgeAtlasSchema.safeParse({ nodes: Array(41).fill(node), edges: [], totalSources: 41, truncated: true }).success).toBe(false)
  })
})
