import { describe, expect, it } from 'vitest'
import { retrieveBrainContext } from '../../src/ai/brainContext'

const sourceId = '10000000-0000-4000-8000-000000000001'

describe('Desktop Brain context', () => {
  it('limits retrieval to selected memories when requested', async () => {
    let requestBody: unknown
    const requester = {
      request: async (request: { method: 'POST'; path: string; body: unknown }) => {
        requestBody = request.body
        return { requestId: 'request-1', status: 200, body: { contexts: [{ sourceId, title: 'Interview notes', startByte: 0, endByte: 18, text: 'Interview questions' }], truncated: false } }
      }
    }
    const retrieved = await retrieveBrainContext(requester, 'What did we ask?', [sourceId])
    expect(requestBody).toEqual({ question: 'What did we ask?', sourceIds: [sourceId] })
    expect(retrieved.contexts[0]?.title).toBe('Interview notes')
  })
})
