import { z } from 'zod'

export const noiseCiphertextMaximumBytes = 65_535
export const noiseTransportPayloadMaximumBytes = 65_519
export const applicationMessageMaximumBytes = 60 * 1024
export const mobileSourceMaximumBytes = 20 * 1024 * 1024
const base64Url = z.string().regex(/^[A-Za-z0-9_-]+$/)
const uuid = z.uuid()
export const isCanonicalNoiseKey = (value: string): boolean => /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value)
const key32 = z.string().refine(isCanonicalNoiseKey)
const relayUrl = z.url().refine(url => {
  const parsed = new URL(url)
  return parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.search && !parsed.hash && parsed.pathname === '/'
})

export const pairingQrSchema = z.object({
  protocolVersion: z.literal(1),
  relayUrl,
  mailboxId: base64Url.min(22).max(43),
  relayTicket: z.string().min(80).max(2048),
  desktopPublicKey: key32,
  pairingId: uuid,
  pairingSecret: key32,
  expiresAt: z.iso.datetime({ offset: true })
}).strict()

export const parsePairingQr = (input: unknown, now: number = Date.now()): PairingQr => {
  const pairing = pairingQrSchema.parse(input)
  if (Date.parse(pairing.expiresAt) <= now) throw new RangeError('Pairing QR has expired')
  return pairing
}

export const pairingPayloadSchema = z.object({
  pairingId: uuid,
  pairingSecret: key32,
  displayName: z.string().trim().min(1).refine(name => new TextEncoder().encode(name).byteLength <= 256)
}).strict()

export const pairedResponseSchema = z.object({
  type: z.literal('paired'),
  deviceId: uuid,
  relayTicket: z.string().min(80).max(2048),
  expiresAt: z.iso.datetime({ offset: true })
}).strict()

export const authenticatedResponseSchema = z.object({
  type: z.literal('authenticated'),
  relayTicket: z.string().min(80).max(2048),
  expiresAt: z.iso.datetime({ offset: true })
}).strict()

export const mobileRequestSchema = z.object({
  version: z.literal(1),
  requestId: uuid,
  issuedAtMs: z.number().int().nonnegative(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE']),
  path: z.string().startsWith('/api/v1/').max(4096),
  body: z.unknown().nullable()
}).strict()

export const mobileResponseSchema = z.object({
  requestId: uuid,
  status: z.number().int().min(100).max(599),
  body: z.unknown()
}).strict()

const boundedMetadataText = (maximumBytes: number) => z.string().refine(value => new TextEncoder().encode(value).byteLength <= maximumBytes)
const sourceMomentSchema = z.object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().nonnegative(), startByte: z.number().int().nonnegative(), endByte: z.number().int().nonnegative() }).strict().refine(moment => moment.endMs >= moment.startMs && moment.endByte > moment.startByte)

export const libraryCardSchema = z.object({
  sourceId: uuid,
  kind: z.enum(['manual_note', 'pasted_text', 'url', 'pdf', 'video', 'document']),
  title: boundedMetadataText(512),
  projectId: uuid.nullable(),
  projectName: boundedMetadataText(512).nullable(),
  folderName: boundedMetadataText(512).nullable().default(null),
  relativePath: boundedMetadataText(4096).nullable().default(null),
  url: z.url().max(8192).nullable(),
  mediaType: z.string().max(255).nullable().optional(),
  moments: z.array(sourceMomentSchema).max(100).optional(),
  revision: z.string().regex(/^[0-9a-f]{64}$/),
  textSha256: z.string().regex(/^[0-9a-f]{64}$/),
  byteLength: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime({ offset: true }),
  downloadEligible: z.boolean(),
  unavailableReason: z.literal('too_large').nullable()
}).strict()

export const libraryListingSchema = z.object({
  items: z.array(libraryCardSchema).max(50),
  nextCursor: base64Url.max(2048).nullable(),
  totalItems: z.number().int().nonnegative()
}).strict()

export const libraryPageSchema = libraryCardSchema.extend({
  totalBytes: z.number().int().nonnegative().max(mobileSourceMaximumBytes),
  offset: z.number().int().nonnegative().max(mobileSourceMaximumBytes),
  nextOffset: z.number().int().positive().max(mobileSourceMaximumBytes).nullable(),
  bytes: base64Url.max(32_768)
}).strict()

const atlasNodeSchema = z.object({
  id: uuid,
  kind: z.literal('source'),
  subjectId: uuid,
  sourceId: uuid,
  label: z.string().max(512),
  summary: z.string().max(512),
  sourceKind: z.enum(['manual_note', 'pasted_text', 'url', 'pdf', 'video', 'document'])
}).strict()

const atlasEdgeSchema = z.object({
  id: uuid,
  kind: z.enum(['similar_to', 'linked_to']),
  fromNodeId: uuid,
  toNodeId: uuid,
  classification: z.enum(['proposal', 'fact']),
  score: z.number(),
  strong: z.enum(['yes', 'no']),
  cluster: z.enum(['yes', 'no']),
  clusterScore: z.number().nullable(),
  clusterConfidence: z.number().nullable()
}).strict()

export const companionContextSchema = z.object({
  contexts: z.array(z.object({
    sourceId: uuid,
    title: z.string().max(512),
    startByte: z.number().int().nonnegative(),
    endByte: z.number().int().positive(),
    text: z.string().refine(value => new TextEncoder().encode(value).byteLength <= 4096)
  }).strict()).max(8),
  truncated: z.boolean()
}).strict()

export const knowledgeAtlasSchema = z.object({
  nodes: z.array(atlasNodeSchema).max(40),
  edges: z.array(atlasEdgeSchema).max(60),
  totalSources: z.number().int().nonnegative(),
  truncated: z.boolean()
}).strict()

export const libraryCheckSchema = z.array(z.discriminatedUnion('state', [
  z.object({ sourceId: uuid, state: z.literal('unavailable') }).strict(),
  z.object({ sourceId: uuid, state: z.literal('replaced'), replacement: z.object({ sourceId: uuid, revision: z.string().regex(/^[0-9a-f]{64}$/) }).strict() }).strict(),
  z.object({ sourceId: uuid, state: z.enum(['unchanged', 'changed']), revision: z.string().regex(/^[0-9a-f]{64}$/) }).strict()
])).max(100)

export type PairingQr = z.infer<typeof pairingQrSchema>
export type MobileRequest = z.infer<typeof mobileRequestSchema>
export type MobileResponse = z.infer<typeof mobileResponseSchema>
