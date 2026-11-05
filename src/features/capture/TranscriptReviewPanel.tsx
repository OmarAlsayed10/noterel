import type { SavedTranscriptCapture } from '../../capture/transcriptCaptures'
import { cloudTranscriptionJob, deleteCloudTranscriptionJob } from '../../transcription/cloud/jobs'
import { AudioTranscriptReviewPanel } from './AudioTranscriptReviewPanel'

const cloudReview = { load: cloudTranscriptionJob, remove: deleteCloudTranscriptionJob }

export function TranscriptReviewPanel({ jobId, ...props }: { readonly jobId: string; readonly cancel: () => void; readonly finished: (capture: SavedTranscriptCapture, notice?: string) => void }) {
  return jobId.startsWith('cloud:') ? <AudioTranscriptReviewPanel {...props} jobId={jobId.slice(6)} source={cloudReview} /> : <AudioTranscriptReviewPanel {...props} jobId={jobId} />
}
