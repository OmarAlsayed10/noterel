import { useCallback, useEffect, useMemo, useState } from 'react'
import { Text, View } from 'react-native'
import { Button } from '../../components/ui'
import { canonicalMemoryIdentity, learningIdentityKey } from '../../learning'
import type { MemoryIdentity } from '../../learning'
import { memorySourceSegments, type SourceSegment } from '../../learning/anchors'
import { styles } from '../../theme/styles'
import type { ReadingMemory } from '../library/types'
import { learningCopy } from './copy'
import { LearningConflict } from './LearningConflict'
import { MemoryLearningForm } from './MemoryLearningForm'
import { useMemoryLearning } from './useMemoryLearning'
import { learningStyles } from './learningStyles'

interface MemoryLearningPanelProps {
  readonly reading: ReadingMemory
  readonly focusQuote: (quote: string) => void
  readonly editingChanged: (editing: boolean) => void
}

export function MemoryLearningPanel({ reading, focusQuote, editingChanged }: MemoryLearningPanelProps) {
  const sourceId = reading.sourceId ?? reading.localSourceId ?? reading.captureId
  const mailboxId = reading.sourceId ? reading.desktopMailboxId ?? null : null
  const identity = useMemo(() => ({ sourceId: sourceId ?? '', mailboxId }), [sourceId, mailboxId])
  const [resolved, setResolved] = useState<{ key: string; identity: MemoryIdentity } | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const key = learningIdentityKey(identity)
  useEffect(() => {
    let current = true
    void canonicalMemoryIdentity(identity).then(canonical => { if (current) setResolved({ key, identity: canonical }) }, () => { if (current) setFailed(true) })
    return () => { current = false }
  }, [identity, key, attempt])
  if (!sourceId) return null
  if (resolved?.key !== key) return <View><Text style={styles.capabilityDetail}>{failed ? learningCopy('loadFailed') : '…'}</Text>{failed && <Button label={learningCopy('retry')} variant="secondary" onPress={() => { setFailed(false); setAttempt(current => current + 1) }} />}</View>
  return <ResolvedLearningPanel key={learningIdentityKey(resolved.identity)} reading={reading} focusQuote={focusQuote} editingChanged={editingChanged} identity={resolved.identity} localIdentity={identity} />
}

function ResolvedLearningPanel({ reading, focusQuote, editingChanged, identity, localIdentity }: MemoryLearningPanelProps & { readonly identity: MemoryIdentity; readonly localIdentity: MemoryIdentity }) {
  const learning = useMemoryLearning(identity)
  const [formDirty, setFormDirty] = useState(false)
  const changeEditing = useCallback((editing: boolean) => { setFormDirty(editing); editingChanged(editing) }, [editingChanged])
  const [localSegments, setLocalSegments] = useState<readonly SourceSegment[]>([])
  useEffect(() => {
    let current = true
    void memorySourceSegments(localIdentity).then(segments => { if (current) setLocalSegments(segments) }, () => { if (current) setLocalSegments([]) })
    return () => { current = false }
  }, [localIdentity])
  const segments = reading.sourceSegments ?? localSegments
  const { entry } = learning
  return <View style={learningStyles.section}>
    <Text accessibilityRole="header" style={styles.panelTitle}>{learningCopy('title')}</Text>
    <Text style={styles.capabilityDetail}>{learningCopy('detail')}</Text>
    {!entry && <Text accessibilityLiveRegion="polite" style={styles.capabilityDetail}>{learning.failed ? learningCopy('loadFailed') : '…'}</Text>}
    {learning.failed && <Button label={learningCopy('retry')} variant="secondary" onPress={() => { void learning.reload() }} />}
    {entry && <>
      <Text style={styles.capabilityDetail}>{learningCopy(identity.mailboxId ? entry.dirty ? 'pending' : 'synced' : 'local')}</Text>
      <LearningConflict entry={entry} busy={learning.busy || formDirty} resolve={choice => { void learning.resolve(choice) }} />
      <MemoryLearningForm key={`${learningIdentityKey(identity)}:${entry.updatedAtMs}:${entry.revision}:${entry.conflict}`} entry={entry} reading={reading} segments={segments} busy={learning.busy} save={learning.save} focusQuote={focusQuote} editingChanged={changeEditing} />
      {identity.mailboxId && <Button label={learningCopy('sync')} variant="secondary" disabled={formDirty} busy={learning.busy} onPress={() => { void learning.sync() }} />}
    </>}
    {learning.notice && <Text accessibilityLiveRegion="polite" style={styles.capabilityDetail}>{learning.notice}</Text>}
  </View>
}
