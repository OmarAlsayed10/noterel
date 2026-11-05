import { useEffect, useMemo, useState } from 'react'
import { connectCompanion } from '../../companion/client'
import { memoryLearning, resolveLearningConflict, saveMemoryLearning, syncLearningEntries, synchronizedLearningIdentity } from '../../learning'
import type { LearningDetails, MemoryIdentity, MemoryLearningEntry } from '../../learning'
import { learningCopy } from './copy'

export function useMemoryLearning(identityInput: MemoryIdentity) {
  const { sourceId, mailboxId } = identityInput
  const identity = useMemo(() => ({ sourceId, mailboxId }), [sourceId, mailboxId])
  const [entry, setEntry] = useState<MemoryLearningEntry | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const activeIdentity = entry?.identity ?? identity
  const reload = async () => {
    try { const loaded = await memoryLearning(activeIdentity); setFailed(false); setEntry(loaded) } catch { setFailed(true); setNotice(learningCopy('loadFailed')) }
  }
  useEffect(() => {
    let current = true
    void memoryLearning(identity).then(loaded => { if (current) { setEntry(loaded); setFailed(false) } }, () => { if (current) { setFailed(true); setNotice(learningCopy('loadFailed')) } })
    return () => { current = false }
  }, [identity])
  const save = async (details: LearningDetails) => {
    setBusy(true)
    try { setEntry(await saveMemoryLearning(activeIdentity, details)); setNotice(learningCopy('saved')); return true } catch { setNotice(learningCopy('failure')); return false } finally { setBusy(false) }
  }
  const sync = async () => {
    setBusy(true)
    setNotice(learningCopy('syncing'))
    try {
      const connection = await connectCompanion()
      let incomplete = false
      let synchronizedIdentity = activeIdentity
      try {
        if (connection.mailboxId !== activeIdentity.mailboxId) throw new Error('The original Desktop is not connected')
        const outcome = await syncLearningEntries(connection, [activeIdentity.sourceId])
        incomplete = outcome.failed > 0 || outcome.pending > 0
        synchronizedIdentity = synchronizedLearningIdentity(activeIdentity, outcome.canonicalSourceIds)
      } finally { connection.close() }
      const latest = await memoryLearning(synchronizedIdentity)
      if (latest.updatedAtMs > 0 || !entry || entry.updatedAtMs === 0) setEntry(latest)
      setNotice(learningCopy(latest.conflict ? 'conflict' : incomplete || latest.dirty ? 'pending' : 'synced'))
    } catch { setNotice(learningCopy('pending')) } finally { setBusy(false) }
  }
  const resolve = async (choice: 'phone' | 'desktop') => {
    setBusy(true)
    try { await resolveLearningConflict(activeIdentity, choice); await reload(); setNotice(learningCopy(choice === 'phone' ? 'pending' : 'saved')) } catch { setNotice(learningCopy('failure')) } finally { setBusy(false) }
  }
  return { entry, notice, busy, failed, reload, save, sync, resolve }
}
