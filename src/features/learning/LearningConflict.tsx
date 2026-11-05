import { Text, View } from 'react-native'
import { Button } from '../../components/ui'
import type { MemoryLearningEntry } from '../../learning'
import { styles } from '../../theme/styles'
import { readableLearningNotes } from '../../learning/portable'
import { contentDirection, learningCopy } from './copy'

export function LearningConflict({ entry, busy, resolve }: { readonly entry: MemoryLearningEntry; readonly busy: boolean; readonly resolve: (choice: 'phone' | 'desktop') => void }) {
  if (!entry.conflict || !entry.remote) return null
  return <View style={styles.connectionsPanel}>
    <Text accessibilityRole="alert" style={styles.staleNotice}>{learningCopy('conflict')}</Text>
    <Text style={styles.capabilityDetail}>{learningCopy('conflictDetail')}</Text>
    <Text style={styles.fieldLabel}>{learningCopy('phoneVersion')}</Text><Text selectable style={[styles.readerText, { writingDirection: contentDirection(entry.details.takeaway) }]}>{readableLearningNotes(learningCopy('phoneVersion'), null, entry.details)}</Text>
    <Text style={styles.fieldLabel}>{learningCopy('desktopVersion')}</Text><Text selectable style={[styles.readerText, { writingDirection: contentDirection(entry.remote.details.takeaway) }]}>{readableLearningNotes(learningCopy('desktopVersion'), null, entry.remote.details)}</Text>
    <View style={styles.buttonRow}><Button label={learningCopy('keepPhone')} disabled={busy} onPress={() => resolve('phone')} /><Button label={learningCopy('useDesktop')} variant="secondary" disabled={busy} onPress={() => resolve('desktop')} /></View>
  </View>
}
