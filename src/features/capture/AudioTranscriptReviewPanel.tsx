import { useEffect, useState } from 'react'
import { Text, TextInput, View } from 'react-native'
import { Button } from '../../components/ui'
import { errorText, t } from '../../i18n'
import type { SavedTranscriptCapture } from '../../capture/transcriptCaptures'
import { audioTranscriptionJob, deleteAudioTranscriptionJob, type AudioTranscriptionJob } from '../../transcription/transcription'
import { saveReviewedTranscript } from '../../transcription/saveTranscript'
import { palette, styles } from '../../theme/styles'
import { VideoSourcePreview } from './VideoSourcePreview'

const localReview = { load: audioTranscriptionJob, remove: deleteAudioTranscriptionJob }
interface TranscriptReviewSource {
  readonly load: (jobId: string) => Promise<AudioTranscriptionJob>
  readonly remove: (jobId: string) => Promise<void>
}

export function AudioTranscriptReviewPanel({ jobId, cancel, finished, source = localReview }: { readonly jobId: string; readonly cancel: () => void; readonly finished: (capture: SavedTranscriptCapture, notice?: string) => void; readonly source?: TranscriptReviewSource }) {
  const [job, setJob] = useState<AudioTranscriptionJob | null>(null)
  const [title, setTitle] = useState(t('transcription.transcript_title'))
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(true)
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    void source.load(jobId).then(job => {
      if (job.state !== 'succeeded' || !job.text) throw new Error(job.error ?? t('transcription.transcription_not_ready'))
      setJob(job)
      setTitle(job.origin?.title || `${t('transcription.transcript_title')} · ${job.title ?? ''}`.replace(/ · $/u, ''))
      setText(job.text)
      setMessage(t('transcription.review_before_saving'))
    }).catch(error => setMessage(errorText(error, 'transcription.transcription_failed'))).finally(() => setBusy(false))
  }, [jobId, source])
  const close = () => { void source.remove(jobId).then(cancel).catch(error => setMessage(errorText(error, 'transcription.transcription_failed'))) }
  const saveTranscript = () => {
    if (!job || !text.trim()) return
    setBusy(true)
    void saveReviewedTranscript(job, { title, text }).then(async capture => {
      let notice: string | undefined
      try { await source.remove(jobId) }
      catch { notice = t('transcription.saved_task_remains') }
      finished(capture, notice)
    }).catch(error => setMessage(errorText(error, 'transcription.save_failed'))).finally(() => setBusy(false))
  }
  return <View style={styles.panel}>
    <Text style={styles.eyebrow}>{t('transcription.review_eyebrow')}</Text>
    <Text style={styles.panelTitle}>{t('transcription.review_title')}</Text>
    {job?.origin && <VideoSourcePreview source={job.origin} />}
    {text && <><Text style={styles.fieldLabel}>{t('common.title')}</Text><TextInput editable={!busy} onChangeText={setTitle} selectionColor={palette.link} style={[styles.input, styles.boxedInput]} value={title} /><Text style={styles.fieldLabel}>{t('transcription.transcript')}</Text><TextInput editable={!busy} multiline onChangeText={setText} selectionColor={palette.link} style={[styles.input, styles.boxedInput, styles.transcriptInput]} textAlignVertical="top" value={text} /><Button label={t('transcription.save_transcript')} onPress={saveTranscript} busy={busy} style={styles.blockButton} /></>}
    {message && <Text accessibilityLiveRegion="polite" style={styles.capabilityDetail}>{message}</Text>}
    <Button label={t('common.cancel')} onPress={close} disabled={busy} variant="secondary" style={styles.blockButton} />
  </View>
}
