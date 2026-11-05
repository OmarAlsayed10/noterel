import { z } from 'zod'
import { companionContextSchema, type MobileResponse } from '../companion/protocol'

interface CompanionRequester {
  readonly request: (input: { method: 'POST'; path: string; body: unknown }) => Promise<MobileResponse>
}

const questionSchema = z.string().trim().min(1).refine(value => new TextEncoder().encode(value).byteLength <= 4096)
const selectedSourceIdsSchema = z.array(z.string().uuid()).min(1).max(500)

export async function retrieveBrainContext(requester: CompanionRequester, question: string, sourceIds?: readonly string[]) {
  const body = { question: questionSchema.parse(question), ...(sourceIds ? { sourceIds: selectedSourceIdsSchema.parse(sourceIds) } : {}) }
  const response = await requester.request({ method: 'POST', path: '/api/v1/companion/context', body })
  if (response.status < 200 || response.status >= 300) throw new Error(`Desktop returned status ${response.status}`)
  return companionContextSchema.parse(response.body)
}
