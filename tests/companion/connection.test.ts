import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('expo-secure-store', () => ({
  getItemAsync: async () => JSON.stringify({ relayUrl: 'https://relay.example.test/', mailboxId: 'a'.repeat(22), desktopPublicKey: 'A'.repeat(43), deviceId: '00000000-0000-4000-8000-000000000001', relayTicket: 't'.repeat(80), expiresAt: '2099-01-01T00:00:00.000Z' })
}))
vi.mock('expo-crypto', () => ({}))
vi.mock('../../modules/kestrel-noise', () => ({ default: { execute: async () => { throw new Error('No native handshake should start before relay authentication') } } }))

interface TestSocket {
  readyState: number
  onclose: ((event: { code: number; reason: string }) => void) | null
  onerror: ((event: { message: string }) => void) | null
  close: () => void
  send: () => void
}

const sockets: TestSocket[] = []

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  sockets.length = 0
  function RelaySocket() {
    const socket: TestSocket = { readyState: 0, onclose: null, onerror: null, send: () => undefined, close: () => { socket.readyState = 3; socket.onclose?.({ code: 1000, reason: '' }) } }
    sockets.push(socket)
    return socket
  }
  Object.assign(RelaySocket, { OPEN: 1 })
  vi.stubGlobal('WebSocket', RelaySocket)
})

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('companion reconnect after failed opening', () => {
  it.each(['timeout', 'socket error'] as const)('closes a %s socket and allows a fresh connection', async failure => {
    const { connectCompanion } = await import('../../src/companion/client')
    const pending = connectCompanion(500)
    const rejected = expect(pending).rejects.toThrow(failure === 'timeout' ? 'timed out' : 'connection failed')
    await vi.advanceTimersByTimeAsync(0)
    expect(sockets).toHaveLength(1)
    if (failure === 'socket error') sockets[0]!.onerror?.({ message: 'Network unavailable' })
    await vi.advanceTimersByTimeAsync(501)
    await rejected
    expect(sockets[0]!.readyState).toBe(3)
    const retry = expect(connectCompanion(500)).rejects.toThrow('timed out')
    await vi.advanceTimersByTimeAsync(501)
    await retry
    expect(sockets).toHaveLength(2)
    expect(sockets.every(socket => socket.readyState === 3)).toBe(true)
  })
})
