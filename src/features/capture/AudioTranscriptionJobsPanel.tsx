import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { Button } from '../../components/ui'
import { t, tm } from '../../i18n'
import { audioTranscriptionJobs, deleteAudioTranscriptionJob, type AudioTranscriptionJob } from '../../transcription/transcription'
import { styles } from '../../theme/styles'

export function AudioTranscriptionJobsPanel({ open, enabled = true }: { readonly open: (jobId: string) => void; readonly enabled?: boolean }) {
  const [jobs, setJobs] = useState<readonly AudioTranscriptionJob[]>([])
  const refresh = () => { void audioTranscriptionJobs().then(setJobs).catch(() => undefined) }
  useEffect(() => {
    if (!enabled) return
    refresh()
    const interval = setInterval(refresh, 1000)
    return () => clearInterval(interval)
  }, [enabled])
  if (jobs.length === 0) return null
  const remove = (jobId: string) => { void deleteAudioTranscriptionJob(jobId).then(refresh) }
  return <View style={styles.transcriptionJobsPanel}>
    <Text style={styles.eyebrow}>{t('transcription.current_jobs')}</Text>
    {jobs.map(job => <View key={job.id} style={styles.transcriptionJobRow}><Pressable accessibilityRole="button" disabled={job.state !== 'succeeded'} onPress={() => open(job.id)} style={styles.libraryCardCopy}><Text numberOfLines={1} style={styles.capabilityName}>{job.title ?? t('transcription.transcript_title')}</Text><View accessibilityRole={job.state === 'transcribing' ? 'progressbar' : undefined} accessibilityValue={job.state === 'transcribing' ? { min: 0, max: 100, now: job.progress } : undefined} style={styles.downloadProgressTrack}><View style={[styles.downloadProgressFill, { width: `${job.progress}%` }]} /></View><Text numberOfLines={2} style={[styles.capabilityDetail, job.state === 'failed' && styles.cacheStateFailed]}>{job.state === 'queued' ? t('transcription.queued') : job.state === 'transcribing' ? `${t('transcription.transcribing')} · ${job.progress}%` : job.state === 'succeeded' ? t('transcription.ready_to_review') : job.error ? tm(job.error) : t('transcription.cancelled')}</Text></Pressable><Button label={job.state === 'succeeded' ? t('transcription.review') : job.state === 'queued' || job.state === 'transcribing' ? t('common.cancel') : t('common.remove')} onPress={() => job.state === 'succeeded' ? open(job.id) : remove(job.id)} variant={job.state === 'failed' || job.state === 'cancelled' ? 'secondary' : 'primary'} style={styles.transcriptionJobAction} /></View>)}
  </View>
}

