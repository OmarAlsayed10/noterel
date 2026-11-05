import { activeCodexCredential } from './codexAuth'
import { requestCodexAnswer, type AskContext, type CodexFetcher } from './codexTransport'

export type { AskContext } from './codexTransport'

export async function askCodex(question: string, contexts: readonly AskContext[], onDelta?: (answer: string) => void, signal?: AbortSignal): Promise<string> {
  const { fetch: expoFetch } = await import('expo/fetch')
  const fetcher = expoFetch as unknown as CodexFetcher
  let credential = await activeCodexCredential(false, signal)
  try {
    return await requestCodexAnswer(fetcher, credential, question, contexts, onDelta, signal)
  } catch (error) {
    if (!(error instanceof Error) || (error as Error & { status?: number }).status !== 401) throw error
    credential = await activeCodexCredential(true, signal)
    return requestCodexAnswer(fetcher, credential, question, contexts, onDelta, signal)
  }
}
