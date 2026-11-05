import { useCallback, useEffect, useState } from 'react'
import { Text, View } from 'react-native'
import { Button } from '../../components/ui'
import { errorText, t } from '../../i18n'
import { cloudAccess } from '../../transcription/cloud/account'
import { cloudJobUploading, deleteCloudTranscriptionJob, refreshCloudJobs, retryCloudUpload } from '../../transcription/cloud/jobs'
import type { StoredCloudJob } from '../../transcription/cloud/protocol'
import { storedCloudJobs } from '../../transcription/cloud/storage'
import { cloudErrorText } from '../../transcription/cloud/transport'
import { styles } from '../../theme/styles'

export function CloudTranscriptionJobsPanel({ open, enabled = true }: { readonly open: (jobId: string) => void; readonly enabled?: boolean }) {
  const [jobs, setJobs] = useState<readonly StoredCloudJob[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const refresh = useCallback(async () => {
    const access = await cloudAccess()
    if (!access?.token || !access.accountId) { setJobs([]); setMessage(null); return }
    setJobs(await storedCloudJobs(access.endpoint, access.accountId))
    setJobs(await refreshCloudJobs())
    setMessage(null)
  }, [])
  useEffect(() => {
    if (!enabled) return
    let running = false
    const update = () => {
      if (running) return
      running = true
      void refresh().catch(error => setMessage(errorText(error, 'cloud.request_failed'))).finally(() => { running = false })
    }
    update()
    const timer = setInterval(update, 5000)
    return () => clearInterval(timer)
  }, [enabled, refresh])
  const act = (job: StoredCloudJob) => {
    if (job.job.state === 'succeeded') { open(`cloud:${job.id}`); return }
    setBusyId(job.id)
    const operation = job.uploadPending && job.job.state !== 'failed' ? retryCloudUpload(job.id) : deleteCloudTranscriptionJob(job.id)
    void operation.then(refresh).catch(error => setMessage(errorText(error, 'cloud.request_failed'))).finally(() => setBusyId(null))
  }
  const discard = (job: StoredCloudJob) => {
    setBusyId(job.id)
    void deleteCloudTranscriptionJob(job.id).then(refresh).catch(error => setMessage(errorText(error, 'cloud.request_failed'))).finally(() => setBusyId(null))
  }
  if (!jobs.length && !message) return null
  return <View style={styles.transcriptionJobsPanel}>
    <Text style={styles.panelTitle}>{t('cloud.tasks')}</Text>
    {jobs.map(stored => {
      const uploading = cloudJobUploading(stored.id)
      const job = stored.job
      const retryable = stored.uploadPending && job.state !== 'failed'
      const pending = job.state === 'queued' || job.state === 'transcribing'
      const label = uploading ? t('cloud.uploading') : job.state === 'failed' ? cloudErrorText(job.errorCode) : stored.uploadPending ? t('cloud.upload_pending') : job.state === 'succeeded' ? t('transcription.ready_to_review') : t('cloud.processing')
      return <View key={stored.id} style={styles.transcriptionJobRow}>
        <View style={styles.libraryCardCopy}>
          <Text numberOfLines={2} style={styles.capabilityName}>{job.title ?? stored.filename}</Text>
          <Text accessibilityLiveRegion="polite" style={styles.capabilityDetail}>{label}</Text>
          {stored.uploadPending && stored.uploadError && <Text style={styles.capabilityDetail}>{stored.uploadError}</Text>}
        </View>
        {(stored.uploadPending || !pending) && <View style={styles.transcriptionJobAction}>
          <Button label={retryable ? t('cloud.retry_upload') : job.state === 'succeeded' ? t('transcription.review') : t('common.remove')} busy={busyId === stored.id || uploading} disabled={busyId !== null && busyId !== stored.id} onPress={() => act(stored)} variant={job.state === 'failed' ? 'secondary' : 'primary'} />
          {retryable && !uploading && <Button label={t('cloud.discard_upload')} variant="secondary" disabled={busyId !== null} onPress={() => discard(stored)} style={styles.blockButton} />}
        </View>}
      </View>
    })}
    {message && <Text accessibilityLiveRegion="polite" style={styles.capabilityDetail}>{message}</Text>}
  </View>
}
