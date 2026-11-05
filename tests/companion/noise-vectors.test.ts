import { describe, expect, it } from 'vitest'
import fixtures from '../fixtures/noise-v1.json'
import { applicationMessageMaximumBytes, noiseCiphertextMaximumBytes, noiseTransportPayloadMaximumBytes } from '../../src/companion/protocol'

describe('shared Noise conformance fixtures', () => {
  it('pins the pairing and returning-device handshakes', () => {
    expect(fixtures.version).toBe(1)
    expect(fixtures.vectors.map(vector => vector.pattern)).toEqual([
      'Noise_XK_25519_ChaChaPoly_BLAKE2s',
      'Noise_IK_25519_ChaChaPoly_BLAKE2s'
    ])
    for (const vector of fixtures.vectors) {
      expect(vector.initiatorStaticPrivate).toHaveLength(64)
      expect(vector.responderStaticPrivate).toHaveLength(64)
      expect(vector.responderStaticPublic).toHaveLength(64)
      expect(vector.handshakeMessages).toHaveLength(vector.handshakePayloads.length)
      expect(vector.initiatorTransportMessages).toHaveLength(2)
      expect(vector.responderTransportMessages).toHaveLength(2)
      for (const transport of [...vector.initiatorTransportMessages, ...vector.responderTransportMessages]) {
        expect(transport.message.length / 2).toBe(transport.plaintext.length / 2 + 16)
      }
    }
  })

  it('pins the Noise framing limits', () => {
    expect(noiseCiphertextMaximumBytes).toBe(65_535)
    expect(noiseTransportPayloadMaximumBytes).toBe(65_519)
    expect(applicationMessageMaximumBytes).toBe(60 * 1024)
  })
})
