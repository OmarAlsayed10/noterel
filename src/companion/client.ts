import * as Crypto from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { z } from 'zod'
import { authenticatedResponseSchema, applicationMessageMaximumBytes, mobileRequestSchema, mobileResponseSchema, pairedResponseSchema, pairingPayloadSchema, pairingQrSchema, parsePairingQr, type MobileRequest, type MobileResponse, type PairingQr } from './protocol'
import { decryptNoise, disposeNoise, encryptNoise, readNoiseHandshake, startNoise, writeNoiseHandshake } from './noise'

const connectionKey = 'kestrel.companion-connection.v1'
const timeoutMs = 60_000
const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

interface StoredConnection {
  readonly relayUrl: string
  readonly mailboxId: string
  readonly desktopPublicKey: string
  readonly deviceId: string
  readonly relayTicket: string
  readonly expiresAt: string
}

interface RelayConnection {
  readonly nextFrame: (timeoutMilliseconds?: number) => Promise<string>
  readonly sendFrame: (payload: string) => void
  readonly close: () => void
  readonly closed: Promise<void>
}

export interface CompanionConnection {
  readonly mailboxId: string
  readonly request: (request: Pick<MobileRequest, 'method' | 'path' | 'body'>, responseTimeoutMilliseconds?: number) => Promise<MobileResponse>
  readonly close: () => void
}

interface RelayWaiter {
  readonly resolve: (frame: string) => void
  readonly reject: (error: Error) => void
  timer?: ReturnType<typeof setTimeout>
}

const storedConnectionSchema = pairingQrSchema.pick({ relayUrl: true, mailboxId: true, desktopPublicKey: true, relayTicket: true, expiresAt: true }).extend({ deviceId: pairedResponseSchema.shape.deviceId }).strict()
const relayAuthenticationSchema = z.object({ type: z.literal('authenticated'), role: z.enum(['pairing', 'device']), peerId: z.string().uuid() }).strict()

const encodeBytes = (bytes: Uint8Array): string => {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const decodeBytes = (value: string): Uint8Array => {
  if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) throw new Error('Relay frame encoding is invalid')
  const decoded = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4))
  const bytes = Uint8Array.from(decoded, character => character.charCodeAt(0))
  if (encodeBytes(bytes) !== value) throw new Error('Relay frame encoding is invalid')
  return bytes
}

const encodeJson = (value: unknown): string => encodeBytes(encoder.encode(JSON.stringify(value)))
const decodeJson = (value: string): unknown => JSON.parse(decoder.decode(decodeBytes(value)))

async function openRelay(relayUrl: string, ticket: string, expectedRole: 'pairing' | 'device', openingTimeoutMilliseconds = timeoutMs): Promise<RelayConnection> {
  const endpoint = new URL('/v1/connect', relayUrl)
  endpoint.protocol = 'wss:'
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint.toString())
    let markClosed = () => {}
    const closed = new Promise<void>(resolveClosed => { markClosed = resolveClosed })
    const queued: string[] = []
    const waiting: RelayWaiter[] = []
    const fail = (error: Error) => {
      while (waiting.length) {
        const waiter = waiting.shift()
        if (waiter) {
          clearTimeout(waiter.timer)
          waiter.reject(error)
        }
      }
    }
    const nextFrame = (timeoutMilliseconds = timeoutMs): Promise<string> => {
      const frame = queued.shift()
      if (frame) return Promise.resolve(frame)
      return new Promise((resolveFrame, rejectFrame) => {
        const waiter: RelayWaiter = { resolve: resolveFrame, reject: rejectFrame }
        waiter.timer = setTimeout(() => {
          const index = waiting.indexOf(waiter)
          if (index >= 0) waiting.splice(index, 1)
          rejectFrame(new Error('Relay frame timed out'))
        }, timeoutMilliseconds)
        waiting.push(waiter)
      })
    }
    let authenticated = false
    let openingTimedOut = false
    const openingTimer = setTimeout(() => {
      openingTimedOut = true
      const error = new Error('Relay connection timed out')
      reject(error)
      fail(error)
      socket.close()
    }, openingTimeoutMilliseconds)
    socket.onopen = () => {
      if (openingTimedOut) {
        socket.close()
        return
      }
      socket.send(JSON.stringify({ type: 'authenticate', ticket }))
    }
    let failureDetail: string | null = null
    socket.onerror = event => {
      failureDetail = (event as { message?: string }).message || 'no detail from the socket'
      setTimeout(() => {
        clearTimeout(openingTimer)
        const error = new Error(`Relay connection failed: ${failureDetail}`)
        if (!authenticated) reject(error)
        fail(error)
        socket.close()
      }, 250)
    }
    let awaitingPong = false
    const heartbeat = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return
      if (awaitingPong) {
        socket.close()
        return
      }
      awaitingPong = true
      socket.send(JSON.stringify({ type: 'ping' }))
    }, 30_000)
    socket.onclose = event => {
      clearTimeout(openingTimer)
      clearInterval(heartbeat)
      markClosed()
      const error = new Error(failureDetail ? `Relay connection failed: ${failureDetail} (close ${event.code}${event.reason ? ` ${event.reason}` : ''})` : event.reason ? `Relay closed the connection: ${event.reason}` : `Relay connection closed (${event.code})`)
      if (!authenticated) reject(error)
      fail(error)
    }
    socket.onmessage = event => {
      try {
        const raw = String(event.data)
        if (encoder.encode(raw).byteLength > 90 * 1024) throw new Error('Relay response is too large')
        const message = JSON.parse(raw) as Record<string, unknown>
        awaitingPong = false
        if (message.type === 'pong') return
        if (message.type === 'authenticated') {
          if (authenticated) throw new Error('Relay authenticated twice')
          const authentication = relayAuthenticationSchema.parse(message)
          if (authentication.role !== expectedRole) throw new Error('Relay role does not match')
          authenticated = true
          clearTimeout(openingTimer)
          resolve({ nextFrame, sendFrame: payload => socket.send(JSON.stringify({ type: 'frame', payload })), close: () => socket.close(), closed })
          return
        }
        if (message.type !== 'frame' || typeof message.payload !== 'string') throw new Error('Relay response is invalid')
        const waiter = waiting.shift()
        if (waiter) {
          clearTimeout(waiter.timer)
          waiter.resolve(message.payload)
        } else {
          if (queued.length >= 4) throw new Error('Relay sent unexpected frames')
          queued.push(message.payload)
        }
      } catch {
        socket.close()
        fail(new Error('Relay response is invalid'))
      }
    }
  })
}

async function savedConnection(): Promise<StoredConnection> {
  const stored = await SecureStore.getItemAsync(connectionKey)
  if (!stored) throw new Error('This phone is not paired')
  const connection = storedConnectionSchema.parse(JSON.parse(stored))
  if (Date.parse(connection.expiresAt) <= Date.now()) throw new Error('Companion relay ticket has expired')
  return connection
}

const retryablePairingFailure = (error: unknown): boolean => error instanceof Error && /unavailable|connection failed|connection closed/iu.test(error.message)

export async function pairCompanion(qrInput: unknown, displayName: string): Promise<void> {
  const qr = parsePairingQr(qrInput)
  const payload = pairingPayloadSchema.parse({ pairingId: qr.pairingId, pairingSecret: qr.pairingSecret, displayName })
  for (let attempt = 1; ; attempt += 1) {
    try {
      await pairOnce(qr, payload)
      return
    } catch (error) {
      if (attempt >= 4 || !retryablePairingFailure(error)) throw error
      await new Promise(resolve => setTimeout(resolve, 5000))
    }
  }
}

async function pairOnce(qr: ReturnType<typeof parsePairingQr>, payload: ReturnType<typeof pairingPayloadSchema.parse>): Promise<void> {
  const relay = await openRelay(qr.relayUrl, qr.relayTicket, 'pairing')
  let sessionId: string | null = null
  try {
    const started = await startNoise('pairing', qr.desktopPublicKey)
    sessionId = started.sessionId
    relay.sendFrame(started.message)
    await readNoiseHandshake(sessionId, await relay.nextFrame())
    relay.sendFrame((await writeNoiseHandshake(sessionId, encodeJson(payload))).message)
    const response = pairedResponseSchema.parse(decodeJson((await decryptNoise(sessionId, await relay.nextFrame())).plaintext))
    const stored: StoredConnection = { relayUrl: qr.relayUrl, mailboxId: qr.mailboxId, desktopPublicKey: qr.desktopPublicKey, deviceId: response.deviceId, relayTicket: response.relayTicket, expiresAt: response.expiresAt }
    await SecureStore.setItemAsync(connectionKey, JSON.stringify(stored))
    disconnectCompanion()
  } finally {
    if (sessionId) await disposeNoise(sessionId)
    relay.close()
  }
}

async function openCompanion(connectionTimeoutMilliseconds: number): Promise<CompanionConnection & { readonly closed: Promise<void> }> {
  const stored = await savedConnection()
  const relay = await openRelay(stored.relayUrl, stored.relayTicket, 'device', connectionTimeoutMilliseconds)
  let started: Awaited<ReturnType<typeof startNoise>> | null = null
  try {
    started = await startNoise('device', stored.desktopPublicKey)
    relay.sendFrame(started.message)
    const authenticated = await readNoiseHandshake(started.sessionId, await relay.nextFrame(connectionTimeoutMilliseconds))
    if (!authenticated.complete) throw new Error('Companion authentication is incomplete')
    const refreshed = authenticatedResponseSchema.parse(decodeJson(authenticated.payload))
    await SecureStore.setItemAsync(connectionKey, JSON.stringify({ ...stored, relayTicket: refreshed.relayTicket, expiresAt: refreshed.expiresAt }))
  } catch (error) {
    if (started) await disposeNoise(started.sessionId)
    relay.close()
    throw error
  }
  if (!started) {
    relay.close()
    throw new Error('Companion session did not start')
  }
  const active = started
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    void disposeNoise(active.sessionId)
    relay.close()
  }
  let requests = Promise.resolve<unknown>(undefined)
  const request = (input: Pick<MobileRequest, 'method' | 'path' | 'body'>, responseTimeoutMilliseconds = timeoutMs): Promise<MobileResponse> => {
    const operation = requests.then(async () => {
      if (closed) throw new Error('Companion connection is closed')
      const outgoing = mobileRequestSchema.parse({ version: 1, requestId: Crypto.randomUUID(), issuedAtMs: Date.now(), ...input })
      const plaintext = encodeJson(outgoing)
      if (decodeBytes(plaintext).byteLength > applicationMessageMaximumBytes) throw new RangeError('Companion request is too large')
      relay.sendFrame((await encryptNoise(active.sessionId, plaintext)).message)
      const response = mobileResponseSchema.parse(decodeJson((await decryptNoise(active.sessionId, await relay.nextFrame(responseTimeoutMilliseconds))).plaintext))
      if (response.requestId !== outgoing.requestId) throw new Error('Companion response does not match request')
      return response
    })
    requests = operation.catch(() => { close() })
    return operation
  }
  return { mailboxId: stored.mailboxId, request, close, closed: relay.closed }
}

let sharedCompanion: Promise<CompanionConnection & { readonly closed: Promise<void> }> | null = null

export function connectCompanion(connectionTimeoutMilliseconds = timeoutMs): Promise<CompanionConnection> {
  if (!sharedCompanion) {
    const opening = openCompanion(connectionTimeoutMilliseconds)
    sharedCompanion = opening
    const forget = () => { if (sharedCompanion === opening) sharedCompanion = null }
    opening.then(connection => { void connection.closed.then(forget) }, forget)
  }
  return sharedCompanion.then(connection => ({ mailboxId: connection.mailboxId, request: connection.request, close: () => {} }))
}

export function disconnectCompanion(): void {
  const current = sharedCompanion
  sharedCompanion = null
  current?.then(connection => connection.close(), () => undefined)
}

export async function currentMailboxId(): Promise<string | null> {
  const stored = await SecureStore.getItemAsync(connectionKey)
  if (!stored) return null
  try {
    const parsed = storedConnectionSchema.safeParse(JSON.parse(stored))
    return parsed.success ? parsed.data.mailboxId : null
  } catch {
    return null
  }
}

export const parsePairingCode = (value: string): PairingQr => parsePairingQr(JSON.parse(value))

export async function companionConnectionState(): Promise<'unpaired' | 'paired' | 'expired' | 'invalid'> {
  const stored = await SecureStore.getItemAsync(connectionKey)
  if (!stored) return 'unpaired'
  try {
    const parsed = storedConnectionSchema.safeParse(JSON.parse(stored))
    if (!parsed.success) return 'invalid'
    return Date.parse(parsed.data.expiresAt) > Date.now() ? 'paired' : 'expired'
  } catch {
    return 'invalid'
  }
}
