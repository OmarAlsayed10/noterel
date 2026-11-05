import { useEffect, useState } from 'react'
import { Alert, Pressable, Text, TextInput, View } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { Button } from '../../components/ui'
import { learningDetailsSchema } from '../../learning'
import type { LearningAnnotation, LearningDetails, MemoryLearningEntry } from '../../learning'
import type { SourceSegment } from '../../learning/anchors'
import { readableLearningNotes } from '../../learning/portable'
import { palette, styles } from '../../theme/styles'
import type { ReadingMemory } from '../library/types'
import { AnnotationComposer } from './AnnotationComposer'
import { AnnotationList } from './AnnotationList'
import { contentDirection, learningCopy } from './copy'
import { learningStyles } from './learningStyles'

interface MemoryLearningFormProps {
  readonly entry: MemoryLearningEntry
  readonly reading: ReadingMemory
  readonly segments: readonly SourceSegment[]
  readonly busy: boolean
  readonly save: (details: LearningDetails) => Promise<boolean>
  readonly focusQuote: (quote: string) => void
  readonly editingChanged: (editing: boolean) => void
}

export function MemoryLearningForm({ entry, reading, segments, busy, save, focusQuote, editingChanged }: MemoryLearningFormProps) {
  const [takeaway, setTakeaway] = useState(entry.details.takeaway)
  const [collections, setCollections] = useState(entry.details.collections.join(', '))
  const [revisit, setRevisit] = useState(entry.details.revisit)
  const [editing, setEditing] = useState<LearningAnnotation | null | undefined>(undefined)
  const [annotationDirty, setAnnotationDirty] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const headerDirty = takeaway !== entry.details.takeaway || collections !== entry.details.collections.join(', ') || revisit !== entry.details.revisit
  const dirty = headerDirty || annotationDirty
  useEffect(() => { editingChanged(dirty); return () => editingChanged(false) }, [dirty, editingChanged])
  const commit = async (annotations = entry.details.annotations) => {
    const names = new Map(collections.split(/[,،]/u).map(name => name.trim()).filter(Boolean).map(name => [name.toLocaleLowerCase(), name]))
    const parsed = learningDetailsSchema.safeParse({ takeaway, collections: [...names.values()], revisit, annotations })
    if (!parsed.success) { setNotice(learningCopy('tooLarge')); return }
    if (await save(parsed.data)) { setEditing(undefined); setAnnotationDirty(false) }
  }
  const remove = (annotationId: string) => Alert.alert(learningCopy('remove'), learningCopy('annotations'), [
    { text: learningCopy('cancel'), style: 'cancel' },
    { text: learningCopy('remove'), style: 'destructive', onPress: () => { void commit(entry.details.annotations.filter(annotation => annotation.id !== annotationId)) } }
  ])
  const copy = async () => {
    try { await Clipboard.setStringAsync(readableLearningNotes(reading.title, reading.url, entry.details)); setNotice(learningCopy('copied')) } catch { setNotice(learningCopy('failure')) }
  }
  return <View style={learningStyles.section}>
    <Text style={styles.fieldLabel}>{learningCopy('takeaway')}</Text>
    <TextInput accessibilityLabel={learningCopy('takeaway')} editable={!busy} multiline maxLength={8192} value={takeaway} onChangeText={setTakeaway} selectionColor={palette.link} style={[styles.input, styles.boxedInput, learningStyles.textArea, { writingDirection: contentDirection(takeaway) }]} />
    <Text style={styles.fieldLabel}>{learningCopy('collections')}</Text>
    <TextInput accessibilityLabel={learningCopy('collections')} editable={!busy} value={collections} maxLength={800} onChangeText={setCollections} placeholder={learningCopy('collectionsHint')} placeholderTextColor={palette.placeholder} selectionColor={palette.link} style={[styles.input, styles.boxedInput, { writingDirection: contentDirection(collections) }]} />
    <Pressable accessibilityLabel={learningCopy('revisit')} accessibilityRole="switch" accessibilityState={{ checked: revisit, disabled: busy }} disabled={busy} onPress={() => setRevisit(current => !current)} style={learningStyles.switch}><Text style={styles.capabilityName}>{revisit ? '✓ ' : '○ '}{learningCopy('revisit')}</Text></Pressable>
    <View style={styles.buttonRow}><Button label={learningCopy('save')} busy={busy} onPress={() => { void commit() }} /><Button label={learningCopy('export')} variant="secondary" disabled={busy || dirty} onPress={() => { void copy() }} /></View>
    {notice && <Text accessibilityLiveRegion="polite" style={styles.capabilityDetail}>{notice}</Text>}
    <Text accessibilityRole="header" style={styles.panelTitle}>{learningCopy('annotations')}</Text>
    <AnnotationList annotations={entry.details.annotations} sourceText={reading.text} sourceUrl={reading.url} segments={segments} busy={busy} focusQuote={focusQuote} edit={annotation => { setEditing(annotation); setAnnotationDirty(false) }} remove={remove} />
    {editing === undefined ? <Button label={learningCopy('add')} variant="secondary" onPress={() => setEditing(null)} disabled={busy} /> : <AnnotationComposer key={editing?.id ?? 'new'} initial={editing} text={reading.text} segments={segments} busy={busy} dirtyChanged={setAnnotationDirty} cancel={() => { setEditing(undefined); setAnnotationDirty(false) }} save={annotation => { void commit([...entry.details.annotations.filter(existing => existing.id !== annotation.id), annotation]) }} />}
  </View>
}
