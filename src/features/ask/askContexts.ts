import { retrieveLocalContexts } from '../../ai/localContext'
import { boundedLocalEvidence , rankLocalContextCandidates } from '../../ai/localContextRanking'
import type { AskContext } from '../../ai/codexClient'
import type { ConnectionState, SelectedAskMemory } from '../../types'
import { retrieveBrainContext } from '../../ai/brainContext'
import { connectCompanion } from '../../companion/client'

const rankedAskContexts = (question: string, contexts: readonly AskContext[]): readonly AskContext[] => rankLocalContextCandidates(question, contexts.map(context => ({ id: context.sourceId, title: context.title, preview: context.text, updatedAtMs: 0 }))).map(context => ({ sourceId: context.id, title: context.title, text: context.preview }))

const desktopAskContexts = async (question: string, sourceIds?: readonly string[]): Promise<readonly AskContext[]> => {
  const connection = await connectCompanion()
  try {
    const retrieved = await retrieveBrainContext(connection, question, sourceIds)
    return retrieved.contexts.map(context => ({ sourceId: context.sourceId, title: context.title, text: context.text }))
  } finally {
    connection.close()
  }
}

export const entireBrainContexts = async (question: string, connectionState: ConnectionState): Promise<readonly AskContext[]> => {
  const local = await retrieveLocalContexts(question)
  if (connectionState !== 'connected' && connectionState !== 'paired') return local
  try {
    return rankedAskContexts(question, [...await desktopAskContexts(question), ...local])
  } catch (error) {
    if (local.length === 0) throw error
    return local
  }
}

export const selectedAskContexts = async (question: string, memories: readonly SelectedAskMemory[], connectionState: ConnectionState): Promise<readonly AskContext[]> => {
  const local = memories.flatMap(memory => memory.text === null ? [] : [{ sourceId: memory.sourceId, title: memory.title, text: boundedLocalEvidence(memory.text, question) }])
  const desktopIds = memories.filter(memory => memory.text === null).map(memory => memory.sourceId)
  if (desktopIds.length === 0) return local
  if (connectionState !== 'connected' && connectionState !== 'paired') throw new Error('Selected Desktop memories require a connection to Desktop.')
  return rankedAskContexts(question, [...await desktopAskContexts(question, desktopIds), ...local])
}
