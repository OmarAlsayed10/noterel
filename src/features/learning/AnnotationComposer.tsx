import { useState } from 'react'
import { Text, TextInput, View } from 'react-native'
import { randomUUID } from 'expo-crypto'
import { Button } from '../../components/ui'
import { learningDetailsSchema } from '../../learning'
import type { LearningAnnotation } from '../../learning'
import { assertAnnotationAnchor, segmentLabel, type SourceSegment } from '../../learning/anchors'
import { palette, styles } from '../../theme/styles'
import { contentDirection, learningCopy } from './copy'
import { learningStyles } from './learningStyles'

interface AnnotationComposerProps {
  readonly initial: LearningAnnotation | null
  readonly text: string
  readonly segments: readonly SourceSegment[]
  readonly busy: boolean
  readonly save: (annotation: LearningAnnotation) => void
  readonly cancel: () => void
  readonly dirtyChanged: (dirty: boolean) => void
}

export function AnnotationComposer({ initial, text, segments, busy, save, cancel, dirtyChanged }: AnnotationComposerProps) {
  const [note, setNote] = useState(initial?.note ?? '')
  const [quote, setQuote] = useState(initial?.quote ?? '')
  const [startMs, setStartMs] = useState(initial?.startMs ?? null)
  const [page, setPage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const submit = () => {
    if (!note.trim()) { setError(learningCopy('emptyNote')); return }
    const annotation = { id: initial?.id ?? randomUUID(), note, quote: quote || null, startMs, createdAtMs: initial?.createdAtMs ?? Date.now() }
    try { assertAnnotationAnchor(annotation, text, segments) } catch { setError(learningCopy('invalidAnchor')); return }
    if (!learningDetailsSchema.shape.annotations.safeParse([annotation]).success) { setError(learningCopy('tooLarge')); return }
    save(annotation)
  }
  return <View style={learningStyles.annotation}>
    <Text accessibilityRole="header" style={styles.fieldLabel}>{learningCopy(initial ? 'edit' : 'add')}</Text>
    <Text style={styles.fieldLabel}>{learningCopy('note')}</Text>
    <TextInput accessibilityLabel={learningCopy('note')} editable={!busy} multiline value={note} maxLength={8192} onChangeText={next => { setNote(next); dirtyChanged(true) }} selectionColor={palette.link} style={[styles.input, styles.boxedInput, learningStyles.textArea, { writingDirection: contentDirection(note) }]} />
    <Text style={styles.fieldLabel}>{learningCopy('quote')}</Text>
    <TextInput accessibilityLabel={learningCopy('quote')} editable={!busy} multiline value={quote} maxLength={2048} onChangeText={next => { setQuote(next); dirtyChanged(true) }} selectionColor={palette.link} style={[styles.input, styles.boxedInput, learningStyles.shortText, { writingDirection: contentDirection(quote) }]} />
    {segments.length > 0 && <><Text style={styles.fieldLabel}>{learningCopy('moment')}</Text><View style={learningStyles.navigation}>
      <Button label={learningCopy('none')} variant="secondary" disabled={busy} onPress={() => { setStartMs(null); dirtyChanged(true) }} />
      {segments.slice(page * 8, page * 8 + 8).map((segment, index) => <Button key={`${segment.startMs}:${index}`} label={`${startMs === segment.startMs ? '✓ ' : ''}${segmentLabel(segment.startMs)}`} variant="secondary" disabled={busy} onPress={() => { setStartMs(segment.startMs); dirtyChanged(true) }} style={learningStyles.moment} />)}
      {page > 0 && <Button label={learningCopy('previous')} variant="secondary" onPress={() => setPage(current => current - 1)} />}
      {(page + 1) * 8 < segments.length && <Button label={learningCopy('more')} variant="secondary" onPress={() => setPage(current => current + 1)} />}
    </View></>}
    {error && <Text accessibilityRole="alert" style={styles.inlineFailure}>{error}</Text>}
    <View style={styles.buttonRow}><Button label={learningCopy(initial ? 'updateNote' : 'addNote')} busy={busy} onPress={submit} /><Button label={learningCopy('cancel')} variant="secondary" disabled={busy} onPress={cancel} /></View>
  </View>
}
