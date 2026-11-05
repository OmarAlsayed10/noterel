import { describe, expect, it, vi } from 'vitest'
import { requestCodexAnswer } from '../../src/ai/codexTransport'

const credential = { access: 'access-token', refresh: 'refresh-token', expires: Date.now() + 60_000, accountId: 'account-123' }

const streamResponse = (events: readonly unknown[]) => {
  const encoded = new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''))
  return {
    ok: true,
    status: 200,
    body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoded); controller.close() } })
  }
}

describe('Codex answers', () => {
  it('streams bounded answer text with source-only instructions', async () => {
    const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { store: boolean; instructions: string }
      expect(body.store).toBe(false)
      expect(body.instructions).toContain('only the supplied sources')
      expect(init.headers).toMatchObject({ Authorization: 'Bearer access-token', 'chatgpt-account-id': 'account-123' })
      return streamResponse([
        { type: 'response.output_text.delta', delta: 'Saved ' },
        { type: 'response.output_text.delta', delta: 'answer [1].' },
        { type: 'response.completed', response: { status: 'completed' } }
      ])
    })
    const updates: string[] = []
    await expect(requestCodexAnswer(fetcher, credential, 'What was saved?', [{ sourceId: 'one', title: 'Note', text: 'Saved answer' }], value => updates.push(value))).resolves.toBe('Saved answer [1].')
    expect(updates).toEqual(['Saved ', 'Saved answer [1].'])
  })

  it('rejects incomplete streams', async () => {
    const fetcher = vi.fn(async () => streamResponse([{ type: 'response.output_text.delta', delta: 'partial' }]))
    await expect(requestCodexAnswer(fetcher, credential, 'Question', [{ sourceId: 'one', title: 'Note', text: 'Context' }])).rejects.toThrow('incomplete')
  })

  it('rejects oversized selected context before sending it', async () => {
    const fetcher = vi.fn()
    await expect(requestCodexAnswer(fetcher, credential, 'Question', [{ sourceId: 'one', title: 'Note', text: 'x'.repeat(49 * 1024) }])).rejects.toThrow('48 KiB')
    expect(fetcher).not.toHaveBeenCalled()
  })
})
