import { Text, View } from 'react-native'
import { Button } from '../../components/ui'
import type { LearningAnnotation } from '../../learning'
import { annotationAvailable, annotationSourceUrl, segmentLabel, type SourceSegment } from '../../learning/anchors'
import { openHttpUrl } from '../../links'
import { styles } from '../../theme/styles'
import { contentDirection, learningCopy } from './copy'
import { learningStyles } from './learningStyles'

interface AnnotationListProps {
  readonly annotations: readonly LearningAnnotation[]
  readonly sourceText: string
  readonly sourceUrl: string | null
  readonly segments: readonly SourceSegment[]
  readonly busy: boolean
  readonly focusQuote: (quote: string) => void
  readonly edit: (annotation: LearningAnnotation) => void
  readonly remove: (annotationId: string) => void
}

export function AnnotationList({ annotations, sourceText, sourceUrl, segments, busy, focusQuote, edit, remove }: AnnotationListProps) {
  return <View>
    {annotations.length === 0 && <Text style={styles.capabilityDetail}>{learningCopy('noAnnotations')}</Text>}
    {annotations.map(annotation => {
      const available = annotationAvailable(annotation, sourceText, segments)
      const momentUrl = annotation.startMs === null ? null : annotationSourceUrl(sourceUrl, annotation.startMs)
      return <View key={annotation.id} style={learningStyles.annotation}>
        {annotation.quote && <Text selectable style={[styles.capabilityDetail, { writingDirection: contentDirection(annotation.quote) }]}>{annotation.quote}</Text>}
        <Text selectable style={[styles.readerText, { writingDirection: contentDirection(annotation.note) }]}>{annotation.note}</Text>
        {annotation.startMs !== null && <Text style={styles.capabilityDetail}>{`${learningCopy('moment')} · ${segmentLabel(annotation.startMs)}`}</Text>}
        {!available && <Text style={styles.staleNotice}>{learningCopy('unavailable')}</Text>}
        <View style={styles.buttonRow}>
          {annotation.quote && available && <Button label={learningCopy('passage')} variant="secondary" onPress={() => focusQuote(annotation.quote!)} />}
          {momentUrl && available && <Button label={`${learningCopy('openMoment')} · ${segmentLabel(annotation.startMs!)}`} variant="secondary" onPress={() => openHttpUrl(momentUrl)} />}
          <Button label={learningCopy('edit')} variant="secondary" disabled={busy} onPress={() => edit(annotation)} />
          <Button label={learningCopy('remove')} variant="secondary" disabled={busy} onPress={() => remove(annotation.id)} />
        </View>
      </View>
    })}
  </View>
}
