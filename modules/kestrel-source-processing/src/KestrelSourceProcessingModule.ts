import { NativeModule, requireNativeModule } from 'expo'

interface FetchedPublicSource {
  readonly finalUrl: string
  readonly mediaType: 'text/html' | 'text/plain'
  readonly text: string
}

interface RecognizedPdfPage {
  readonly pageNumber: number
  readonly text: string
  readonly words: readonly { readonly text: string; readonly left: number; readonly top: number; readonly width: number; readonly height: number; readonly confidence: number | null }[]
}

declare class KestrelSourceProcessingModule extends NativeModule {
  installPackage(path: string): Promise<void>
  scheduleUpdateChecks(url: string, edition: 'public' | 'internal'): Promise<void>
  cancelUpdateChecks(): Promise<void>
  enqueueAppUpdate(url: string, sha256: string, version: number): Promise<void>
  appUpdateDownloadState(): Promise<{ readonly state: 'idle' | 'queued' | 'downloading' | 'ready' | 'failed'; readonly versionCode: number; readonly progress: number; readonly path: string | null; readonly error: string | null }>
  readNoteImport(uri: string, filename: string): Promise<{ readonly kind: 'archive' | 'anki'; readonly notes: readonly { readonly title: string; readonly text: string; readonly sourcePath: string }[] }>
  installedTranscriptionModels(): Promise<readonly ('small' | 'medium')[]>
  downloadTranscriptionModel(model: 'small' | 'medium', language: 'ar' | 'en'): Promise<void>
  transcriptionModelDownloadState(model: 'small' | 'medium'): Promise<{ readonly state: 'idle' | 'queued' | 'downloading' | 'succeeded' | 'failed' | 'cancelled'; readonly downloadedBytes: number; readonly totalBytes: number; readonly error?: string | null }>
  cancelTranscriptionModelDownload(model: 'small' | 'medium'): Promise<void>
  deleteTranscriptionModel(model: 'small' | 'medium'): Promise<number>
  enqueueAudioTranscription(uri: string, title: string, options: { readonly model: 'small' | 'medium'; readonly language: 'auto' | 'ar' | 'en'; readonly interfaceLanguage: 'ar' | 'en'; readonly originJson?: string }): Promise<string>
  uploadTranscriptionBetaFile(uri: string, options: { readonly url: string; readonly token: string; readonly filename: string; readonly language: 'auto' | 'ar' | 'en' }): Promise<{ readonly status: number; readonly body: string }>
  audioTranscriptionJob(jobId: string): Promise<{ readonly id: string; readonly state: 'queued' | 'transcribing' | 'succeeded' | 'failed' | 'cancelled' | 'missing'; readonly progress: number; readonly title?: string | null; readonly text?: string | null; readonly detectedLanguages?: readonly string[]; readonly durationSeconds?: number | null; readonly error?: string | null; readonly originJson?: string | null; readonly originReadError?: boolean }>
  audioTranscriptionJobs(): Promise<readonly { readonly id: string; readonly state: 'queued' | 'transcribing' | 'succeeded' | 'failed' | 'cancelled' | 'missing'; readonly progress: number; readonly title?: string | null; readonly text?: string | null; readonly detectedLanguages?: readonly string[]; readonly durationSeconds?: number | null; readonly error?: string | null; readonly originJson?: string | null; readonly originReadError?: boolean }[]>
  deleteAudioTranscriptionJob(jobId: string): Promise<void>
  downloadedTranslationModels(): Promise<readonly string[]>
  downloadTranslationModel(language: string, interfaceLanguage: 'ar' | 'en'): Promise<void>
  translationModelDownloadStates(languages: readonly string[]): Promise<readonly { readonly language: string; readonly state: 'idle' | 'queued' | 'downloading' | 'succeeded' | 'failed' | 'cancelled'; readonly error?: string | null }[]>
  deleteTranslationModel(language: string): Promise<void>
  translateText(text: string, targetLanguage: string): Promise<{ readonly sourceLanguage: string; readonly text: string }>
  probeWebSocket(url: string): Promise<{ readonly state: 'open' | 'failed' | 'timeout'; readonly detail: string; readonly status?: number | null }>
  fetchPublicSource(url: string): Promise<FetchedPublicSource>
  fetchYouTubePlayer(videoId: string, apiKey: string): Promise<string>
  fetchYouTubeCaptions(url: string): Promise<string>
  fetchTikTokCaptions(url: string): Promise<string>
  fetchFacebookVideo(url: string): Promise<{ readonly finalUrl: string; readonly html: string }>
  prepareFacebookVideoMedia(url: string, requestId: string): Promise<{ readonly uri: string; readonly filename: string; readonly size: number; readonly mediaType: 'audio/mp4' | 'video/mp4' }>
  cancelFacebookVideoMedia(requestId: string): void
  releaseFacebookVideoMedia(requestId: string): void
  fetchFacebookCaptions(url: string): Promise<string>
  fetchYouTubeThumbnail(url: string): Promise<{ readonly mediaType: 'image/jpeg' | 'image/webp' | 'image/png'; readonly base64: string }>
  recognizeImage(uri: string): Promise<{ readonly engine: string; readonly engineVersion: string; readonly width: number; readonly height: number; readonly text: string; readonly words: readonly RecognizedPdfPage['words'][number][] }>
  recognizePdf(uri: string): Promise<{ readonly engine: string; readonly engineVersion: string; readonly language: string; readonly pages: readonly RecognizedPdfPage[] }>
}

export default requireNativeModule<KestrelSourceProcessingModule>('KestrelSourceProcessing')
