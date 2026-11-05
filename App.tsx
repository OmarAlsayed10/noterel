import { saveCaptureLocally, prepareCapturedSource } from './src/capture/saveCapture'
import type { SavedTranscriptCapture } from './src/capture/transcriptCaptures'
import { captureCopy } from './src/features/capture/captureCopy'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, AppState, BackHandler, Linking, Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { usePreventScreenCapture } from 'expo-screen-capture'
import { queuedCaptureCount } from './src/capture/outbox'
import { drainCaptureOutbox } from './src/capture/drainOutbox'
import { deliverProcessedSources } from './src/capture/autoDeliver'
import { companionConnectionState, connectCompanion, disconnectCompanion } from './src/companion/client'
import { cancelUpdateNotifications, checkForUpdate, downloadUpdate, installUpdate, scheduleUpdateNotifications, updateDownloadState, type AvailableUpdate, type UpdateDownloadState } from './src/updates/appUpdates'
import { normalizeIncomingShare, type IncomingShare } from './src/capture/incomingShare'
import { pendingPdfCount, savePendingPdf, type PdfCandidate } from './src/capture/pdfImports'
import { pendingImageCount, processNextQueuedImage, savePendingImage, type ImageCandidate } from './src/capture/imageImports'
import { syncAutomaticBackup } from './src/backup/desktopBackup'
import { processNextQueuedLocalExtraction, queueLocalPdfProcessing } from './src/sources/artifacts'
import { BottomNavigation, ScreenHeading } from './src/components/shared'
import { AskPanel } from './src/features/ask/AskPanel'
import { ImageCapturePanel, ManualCapturePanel, PdfProcessingPanel, QuickCapturePanel, QuickPdfCapturePanel, SharePanel } from './src/features/capture/CapturePanels'
import { AudioTranscriptionJobsPanel } from './src/features/capture/AudioTranscriptionPanel'
import { TranscriptionCapturePanel } from './src/features/capture/TranscriptionCapturePanel'
import { CloudTranscriptionJobsPanel } from './src/features/capture/CloudTranscriptionJobsPanel'
import { TranscriptReviewPanel } from './src/features/capture/TranscriptReviewPanel'
import { CloudTranscriptionBetaPanel } from './src/features/settings/CloudTranscriptionBetaPanel'
import { QuickCaptureLayout } from './src/features/capture/QuickCaptureLayout'
import { LibraryPanel } from './src/features/library/LibraryPanel'
import { CodexSettingsPanel, DesktopBackupPanel, NotesBackupPanel, PairingPanel } from './src/features/settings/SettingsPanels'
import { styles } from './src/theme/styles'
import type { ConnectionState, NavigationTab, SelectedAskMemory } from './src/types'
import { t, tf, type Language, errorText } from './src/i18n'
import { loadLanguage } from './src/i18n/storage'
import { AppearancePanel } from './src/features/settings/AppearancePanel'
import { loadTheme } from './src/theme/storage'
import { currentTheme } from './src/theme/theme'
import { LanguagePanel } from './src/features/settings/LanguagePanel'
import { TranscriptionModelsPanel } from './src/features/settings/TranscriptionModelsPanel'
import { PlansPage } from './src/features/settings/PlansPage'
import { UpdatePanel, UpdateProgressModal } from './src/features/settings/UpdatePanel'
import { appDisplayName, appScheme, codexEnabled, directUpdatesEnabled } from './src/edition'
import type { AudioCandidate } from './src/transcription/transcription'
import { InAppNotice } from './src/components/ui'
import { requestNotificationPermission } from './src/notifications'
import { transcriptionMediaKind } from './src/transcription/media'
import { discardTemporaryAudio } from './src/transcription/transcription'
import { useVideoRecovery } from './src/features/capture/useVideoRecovery'

const imageMediaType = (mediaType: string | null): mediaType is ImageCandidate['mediaType'] => mediaType === 'image/jpeg' || mediaType === 'image/png' || mediaType === 'image/webp'

const parsedInitialShare = (text: string | null): { readonly share: IncomingShare | null; readonly state: 'review' | 'failed' } => {
  if (!text?.trim()) return { share: null, state: 'review' }
  try {
    return { share: normalizeIncomingShare({ text }), state: 'review' }
  } catch {
    return { share: null, state: 'failed' }
  }
}

function BaselineScreen({ initialQuickCapture, initialQuickCaptureText, initialAudio, initialImage, initialPdf, language, languageChanged, themeChanged }: { readonly language: Language; readonly languageChanged: (language: Language) => void; readonly themeChanged: () => void; readonly initialQuickCapture: boolean; readonly initialQuickCaptureText: string | null; readonly initialAudio: AudioCandidate | null; readonly initialImage: ImageCandidate | null; readonly initialPdf: PdfCandidate | null }) {
  usePreventScreenCapture('kestrel-sensitive-content')
  const [activeTab, setActiveTab] = useState<NavigationTab>('library')
  const [selectedAskMemories, setSelectedAskMemories] = useState<readonly SelectedAskMemory[]>([])
  const [compactCapture, setCompactCapture] = useState(initialQuickCapture)
  const [initialShare] = useState(() => parsedInitialShare(initialQuickCaptureText))
  const [incomingShare, setIncomingShare] = useState<IncomingShare | null>(initialShare.share)
  const [incomingPdf, setIncomingPdf] = useState<PdfCandidate | null>(initialPdf)
  const [incomingImage, setIncomingImage] = useState<ImageCandidate | null>(initialImage)
  const [incomingAudio, setIncomingAudio] = useState<AudioCandidate | null>(initialAudio)
  const [transcriptJobId, setTranscriptJobId] = useState<string | null>(null)
  const [connectionState, setConnectionState] = useState<ConnectionState>('loading')
  const [availableUpdate, setAvailableUpdate] = useState<AvailableUpdate | null>(null)
  const [installingUpdate, setInstallingUpdate] = useState(false)
  const [updateDownload, setUpdateDownload] = useState<UpdateDownloadState | null>(null)
  const installationAttemptedVersion = useRef(0)
  const startingUpdate = useRef(false)
  const reportedUpdateError = useRef('')
  const [plansOpen, setPlansOpen] = useState(false)
  const [captureNotice, setCaptureNotice] = useState<string | null>(null)
  const [taskNotice, setTaskNotice] = useState<string | null>(null)
  const [captureFileShortcut, setCaptureFileShortcut] = useState(0)
  const [pendingCaptureCount, setPendingCaptureCount] = useState<number | null>(null)
  const [localRevision, setLocalRevision] = useState(0)
  const [shareState, setShareState] = useState<'review' | 'saving' | 'failed'>(initialShare.state)
  const processingQueuedSource = useRef(false)
  const deliveringProcessed = useRef(false)
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (compactCapture || activeTab === 'library') return false
      setActiveTab('library')
      return true
    })
    return () => subscription.remove()
  }, [activeTab, compactCapture])
  const pickImage = (image: ImageCandidate) => { setIncomingImage(image); setIncomingPdf(null); setIncomingAudio(null); setIncomingShare(null); setShareState('review') }
  const pickPdf = (pdf: PdfCandidate) => { setIncomingPdf(pdf); setIncomingImage(null); setIncomingAudio(null); setIncomingShare(null) }
  const pickAudio = (audio: AudioCandidate) => {
    if (incomingAudio && incomingAudio.uri !== audio.uri) discardTemporaryAudio(incomingAudio)
    setTranscriptJobId(null)
    setIncomingAudio(audio)
    setIncomingPdf(null)
    setIncomingImage(null)
    setIncomingShare(null)
    setShareState('review')
    setCaptureNotice(null)
  }
  const videoRecovery = useVideoRecovery({ context: activeTab, selected: audio => { pickAudio(audio); setCompactCapture(false); setActiveTab('add') }, notice: setTaskNotice })
  const selectAskMemory = (memory: SelectedAskMemory) => {
    setSelectedAskMemories(current => current.some(selected => selected.sourceId === memory.sourceId) ? current : [...current, memory])
    setActiveTab('ask')
  }
  const refreshConnectionState = useCallback(() => {
    setConnectionState('loading')
    void companionConnectionState().then(setConnectionState)
  }, [])
  const markDesktopUnavailable = useCallback(() => setConnectionState('offline'), [])
  const refreshPendingCaptureCount = useCallback(() => {
    void queuedCaptureCount().then(async captures => captures + await pendingPdfCount() + await pendingImageCount()).then(count => setPendingCaptureCount(previous => {
      if (previous !== null && previous !== count) setLocalRevision(revision => revision + 1)
      return count
    })).catch(() => setPendingCaptureCount(null))
  }, [])
  const drainQueuedSources = useCallback(() => {
    if (processingQueuedSource.current || AppState.currentState !== 'active') return
    processingQueuedSource.current = true
    const drain = async () => {
      try {
        while (AppState.currentState === 'active') {
          const processed = await processNextQueuedImage() || await processNextQueuedLocalExtraction()
          if (!processed) break
          setLocalRevision(revision => revision + 1)
        }
      } catch (error) {
        setTaskNotice(errorText(error, 'app.source_processing_stopped_retry_the_item_from'))
      } finally {
        processingQueuedSource.current = false
      }
    }
    void drain()
  }, [])
  useEffect(() => { void companionConnectionState().then(setConnectionState) }, [])
  useEffect(refreshPendingCaptureCount, [refreshPendingCaptureCount])
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        refreshPendingCaptureCount()
        drainQueuedSources()
      } else disconnectCompanion()
    })
    return () => subscription.remove()
  }, [drainQueuedSources, refreshPendingCaptureCount])
  useEffect(drainQueuedSources, [drainQueuedSources, localRevision])
  useEffect(() => {
    if (directUpdatesEnabled) {
      void checkForUpdate().then(setAvailableUpdate).catch(() => undefined)
      void scheduleUpdateNotifications().catch(error => setTaskNotice(errorText(error, 'settings.update_check_failed')))
    } else void cancelUpdateNotifications().catch(error => setTaskNotice(errorText(error, 'settings.update_failed')))
  }, [])
  const refreshUpdateDownload = useCallback(() => {
    void updateDownloadState().then(status => {
      setUpdateDownload(status)
      if (status.state === 'queued' || status.state === 'downloading') setInstallingUpdate(true)
      else if (status.state === 'ready' && status.path && AppState.currentState === 'active') {
        if (installationAttemptedVersion.current === status.versionCode) return
        installationAttemptedVersion.current = status.versionCode
        void installUpdate(status.path).catch(error => setTaskNotice(errorText(error, 'settings.update_failed'))).finally(() => setInstallingUpdate(false))
      } else if (status.state === 'failed') {
        setInstallingUpdate(false)
        const failure = `${status.versionCode}:${status.error}`
        if (reportedUpdateError.current !== failure) {
          reportedUpdateError.current = failure
          setTaskNotice(status.error ?? t('settings.update_failed'))
        }
      } else if (!startingUpdate.current) setInstallingUpdate(false)
    }).catch(error => { setInstallingUpdate(false); setTaskNotice(errorText(error, 'settings.update_failed')) })
  }, [])
  useEffect(() => {
    if (!directUpdatesEnabled) return
    refreshUpdateDownload()
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') refreshUpdateDownload() })
    return () => subscription.remove()
  }, [refreshUpdateDownload])
  useEffect(() => {
    if (updateDownload?.state !== 'queued' && updateDownload?.state !== 'downloading') return
    const timer = setInterval(() => { if (AppState.currentState === 'active') refreshUpdateDownload() }, 1200)
    return () => clearInterval(timer)
  }, [refreshUpdateDownload, updateDownload?.state])
  useEffect(() => {
    const openShortcut = (url: string | null) => {
      const addNoteUrl = `${appScheme}://capture/note`
      const clipboardUrl = `${appScheme}://capture/clipboard`
      const oversizedClipboardUrl = `${clipboardUrl}?error=clipboard-too-large`
      const audioUrl = `${appScheme}://capture/audio`
      const parsedUrl = url?.startsWith(`${appScheme}://`) ? new URL(url) : null
      if (url === addNoteUrl) setActiveTab('add')
      if (url === audioUrl) { setCaptureFileShortcut(value => value + 1); setActiveTab('add') }
      if (parsedUrl?.host === 'capture' && parsedUrl.pathname === '/transcript') { setTranscriptJobId(parsedUrl.searchParams.get('job')); setActiveTab('add') }
      if (initialQuickCapture && (url === clipboardUrl || url === oversizedClipboardUrl)) setCompactCapture(true)
      if (initialQuickCapture && url === oversizedClipboardUrl) setCaptureNotice(t('app.clipboard_content_exceeds_the_1_mib_capture'))
    }
    void Linking.getInitialURL().then(openShortcut)
    const subscription = Linking.addEventListener('url', event => openShortcut(event.url))
    return () => subscription.remove()
  }, [initialQuickCapture])
  useEffect(() => {
    if (connectionState !== 'connected' || pendingCaptureCount === null) return
    void connectCompanion().then(async connection => {
      try {
        await syncAutomaticBackup(connection, t('common.android_phone'))
      } finally {
        connection.close()
      }
    }).catch(() => undefined)
  }, [connectionState, localRevision, pendingCaptureCount])
  useEffect(() => {
    if (connectionState !== 'paired') return
    let disposed = false
    let currentConnection: Awaited<ReturnType<typeof connectCompanion>> | null = null
    const deliver = async () => {
      try {
        const connection = await connectCompanion(60_000)
        currentConnection = connection
        if (disposed) {
          connection.close()
          return
        }
        let deliveredOperationIds: readonly string[] = []
        try {
          deliveredOperationIds = (await drainCaptureOutbox(connection)).deliveredOperationIds
        } finally {
          connection.close()
          currentConnection = null
        }
        if (!disposed) {
          setConnectionState('connected')
          refreshPendingCaptureCount()
        }
        if (deliveredOperationIds.length && !disposed) setCaptureNotice(tf('app.captures_accepted', { count: deliveredOperationIds.length }))
      } catch {
        if (!disposed) {
          setConnectionState('offline')
          setCaptureNotice(previous => previous ?? t('app.desktop_is_currently_unreachable_captures_remain_saved'))
        }
      }
    }
    void deliver()
    return () => {
      disposed = true
      currentConnection?.close()
    }
  }, [connectionState, refreshPendingCaptureCount])
  useEffect(() => {
    if (connectionState !== 'connected' || deliveringProcessed.current) return
    deliveringProcessed.current = true
    void deliverProcessedSources().then(delivered => {
      if (delivered > 0) {
        setCaptureNotice(tf('app.processed_sources_sent', { count: delivered }))
        setLocalRevision(revision => revision + 1)
      }
    }).catch(() => undefined).finally(() => { deliveringProcessed.current = false })
  }, [connectionState, localRevision])
  const discardShare = useCallback(() => {
    setIncomingShare(null)
    setIncomingPdf(null)
    setIncomingImage(null)
    setIncomingAudio(null)
    setShareState('review')
  }, [])
  const saveCapture = useCallback(async (capture: IncomingShare): Promise<boolean> => {
    setShareState('saving')
    let captureId: string
    try {
      captureId = await saveCaptureLocally(capture)
    } catch {
      setShareState('failed')
      return false
    }
    try {
      if (capture.kind === 'url') {
        const prepared = await prepareCapturedSource(captureId, capture)
        setCaptureNotice(prepared ? t('app.link_saved_securely_extraction_progress_is_available') : captureCopy('saved'))
      } else setCaptureNotice(t('app.note_saved_on_this_phone_send_it'))
    } catch {
      setCaptureNotice(t('app.the_capture_was_saved_but_its_processing'))
    }
    refreshPendingCaptureCount()
    return true
  }, [refreshPendingCaptureCount])
  const closeQuickCapture = () => {
    BackHandler.exitApp()
  }
  const transcriptionStarted = () => {
    setCaptureNotice(tf('transcription.started_in_background', { app: appDisplayName }))
    if (compactCapture) closeQuickCapture()
    else discardShare()
  }
  const cloudTranscriptionStarted = () => {
    setCaptureNotice(t('cloud.task_created'))
    if (compactCapture) closeQuickCapture()
    else discardShare()
  }
  const transcriptSaved = (capture: SavedTranscriptCapture, notice?: string) => {
    refreshPendingCaptureCount()
    setLocalRevision(revision => revision + 1)
    const savedMessage = t(capture.originalPreserved ? 'transcription.saved_original_preserved' : capture.replaced ? 'transcription.saved_recovered' : 'transcription.saved_with_source')
    setTaskNotice([savedMessage, notice].filter(Boolean).join(' '))
    setTranscriptJobId(null)
    setActiveTab('library')
  }
  const confirmQuickCapture = (capture: IncomingShare) => {
    void saveCapture(capture).then(saved => { if (saved) closeQuickCapture() })
  }
  const confirmImage = () => {
    if (!incomingImage || shareState === 'saving') return
    setShareState('saving')
    void savePendingImage(incomingImage).then(() => {
      refreshPendingCaptureCount()
      if (compactCapture) closeQuickCapture()
      else {
        discardShare()
        setCaptureNotice(t('app.image_saved_securely_on_device_text_recognition'))
        setActiveTab('library')
      }
    }).catch(error => {
      setCaptureNotice(errorText(error, 'app.the_image_could_not_be_saved_securely'))
      setShareState('failed')
    })
  }
  const confirmQuickPdf = () => {
    if (!incomingPdf || shareState === 'saving') return
    setShareState('saving')
    void savePendingPdf(incomingPdf).then(async pending => {
      await queueLocalPdfProcessing(pending.id)
      refreshPendingCaptureCount()
      closeQuickCapture()
    }).catch(error => {
      setCaptureNotice(errorText(error, 'common.the_pdf_could_not_be_saved_securely'))
      setShareState('failed')
    })
  }
  const startUpdate = () => {
    if (!availableUpdate || installingUpdate) return
    Alert.alert(tf('app.update_banner', { version: availableUpdate.versionName }), [availableUpdate.notes, t('settings.save_before_update')].filter(Boolean).join('\n\n'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings.download_and_install'), onPress: () => {
        setInstallingUpdate(true)
        setTaskNotice(null)
        if (updateDownload?.state === 'ready' && updateDownload.versionCode === availableUpdate.versionCode && updateDownload.path) {
          installationAttemptedVersion.current = availableUpdate.versionCode
          void installUpdate(updateDownload.path).catch(error => setTaskNotice(errorText(error, 'settings.update_failed'))).finally(() => setInstallingUpdate(false))
          return
        }
        startingUpdate.current = true
        reportedUpdateError.current = ''
        void requestNotificationPermission().then(async allowed => {
          if (!allowed) throw new Error(t('settings.update_notifications_required'))
          await downloadUpdate(availableUpdate)
          void scheduleUpdateNotifications().catch(error => setTaskNotice(errorText(error, 'settings.update_check_failed')))
        }).then(refreshUpdateDownload).catch(error => { setInstallingUpdate(false); setTaskNotice(errorText(error, 'settings.update_failed')) }).finally(() => { startingUpdate.current = false })
      } }
    ])
  }
  const direction = { direction: language === 'ar' ? 'rtl' as const : 'ltr' as const }
  if (compactCapture) return <SafeAreaView style={[styles.quickCaptureScreen, direction]}>
    <StatusBar style="light" />
    <QuickCaptureLayout notice={captureNotice}>
      {incomingAudio ? <TranscriptionCapturePanel key={incomingAudio.uri} cloudStarted={cloudTranscriptionStarted} audio={incomingAudio} cancel={closeQuickCapture} compact openSettings={() => { setCompactCapture(false); setActiveTab('settings') }} started={transcriptionStarted} /> : incomingImage ? <ImageCapturePanel image={incomingImage} save={confirmImage} cancel={closeQuickCapture} state={shareState} compact /> : incomingPdf ? <QuickPdfCapturePanel pdf={incomingPdf} save={confirmQuickPdf} cancel={closeQuickCapture} state={shareState} /> : <QuickCapturePanel key={incomingShare?.text ?? 'empty'} share={incomingShare} save={confirmQuickCapture} cancel={closeQuickCapture} state={shareState} />}
    </QuickCaptureLayout>
    <UpdateProgressModal progress={updateDownload?.progress ?? 0} visible={installingUpdate} />
  </SafeAreaView>
  return <SafeAreaView style={[styles.safeArea, direction]}>
    <StatusBar style={currentTheme().mode === 'dark' ? 'light' : 'dark'} />
    {availableUpdate && <Pressable accessibilityRole="button" accessibilityState={{ busy: installingUpdate, disabled: installingUpdate }} disabled={installingUpdate} onPress={startUpdate} style={styles.updateBanner}><Text style={styles.updateBannerText}>{installingUpdate ? t('common.updating') : tf('app.update_banner', { version: availableUpdate.versionName })}</Text></Pressable>}
    <View style={styles.content}>
      <View style={activeTab === 'library' ? styles.content : styles.hiddenTab}><LibraryPanel videoRecovery={videoRecovery} key={language} active={activeTab === 'library'} connectionState={connectionState} desktopUnavailable={markDesktopUnavailable} localRevision={localRevision} onAsk={codexEnabled ? selectAskMemory : null} onOpenSettings={() => setActiveTab('settings')} onOpenTranscript={jobId => { setTranscriptJobId(jobId); setActiveTab('add') }} /></View>
      {activeTab === 'ask' && codexEnabled && <AskPanel connectionState={connectionState} openSettings={() => setActiveTab('settings')} chooseMemories={() => setActiveTab('library')} removeMemory={sourceId => setSelectedAskMemories(current => current.filter(memory => memory.sourceId !== sourceId))} selectedMemories={selectedAskMemories} />}
      <ScrollView style={activeTab === 'add' ? styles.content : styles.hiddenTab} contentContainerStyle={styles.tabPage}>
        <ScreenHeading eyebrow={t('common.add_eyebrow')} title={t('app.capture_something_useful')} summary={t('app.save_an_encrypted_note_link_image_or')} />
        {(connectionState === 'unpaired' || connectionState === 'expired' || connectionState === 'invalid') && <Text style={styles.notice}>{tf('app.stored_only_on_this_phone_uninstalling_kestrel', { app: appDisplayName })}</Text>}
        {transcriptJobId && <TranscriptReviewPanel jobId={transcriptJobId} cancel={() => setTranscriptJobId(null)} finished={transcriptSaved} />}
        {incomingShare && <SharePanel share={incomingShare} discard={discardShare} state={shareState} />}
        {incomingImage && <ImageCapturePanel image={incomingImage} save={confirmImage} cancel={discardShare} state={shareState} compact={false} />}
        {incomingPdf && <PdfProcessingPanel pdf={incomingPdf} finished={message => { discardShare(); setCaptureNotice(message); refreshPendingCaptureCount(); setActiveTab('library') }} />}
        {incomingAudio && <TranscriptionCapturePanel key={incomingAudio.uri} cloudStarted={cloudTranscriptionStarted} active={activeTab === 'add'} audio={incomingAudio} cancel={discardShare} compact={false} openSettings={() => setActiveTab('settings')} started={transcriptionStarted} />}
        {captureNotice && <Text style={styles.notice}>{captureNotice}</Text>}
        {pendingCaptureCount !== null && pendingCaptureCount > 0 && <Text style={styles.notice}>{tf('app.captures_waiting', { count: pendingCaptureCount })}</Text>}
        {!transcriptJobId && !incomingShare && !incomingImage && !incomingPdf && !incomingAudio && <><CloudTranscriptionJobsPanel enabled={activeTab === 'add'} open={setTranscriptJobId} /><AudioTranscriptionJobsPanel enabled={activeTab === 'add'} open={setTranscriptJobId} /></>}
        <View style={transcriptJobId || incomingShare || incomingImage || incomingPdf || incomingAudio ? styles.hiddenTab : undefined}><ManualCapturePanel initialCaptureKind={captureFileShortcut > 0 ? 'file' : 'note'} key={captureFileShortcut} onChooseAudio={pickAudio} onChooseImage={pickImage} onChoosePdf={pickPdf} onNotice={setCaptureNotice} onQueueChanged={refreshPendingCaptureCount} onSaved={() => setActiveTab('library')} /></View>
      </ScrollView>
      {activeTab === 'settings' && <ScrollView contentContainerStyle={styles.tabPage}>
        <ScreenHeading eyebrow={t('app.settings_eyebrow')} title={t('app.your_private_companion')} summary={t('app.manage_desktop_pairing_encrypted_recovery_storage_and')} />
        <LanguagePanel changed={languageChanged} />
        <CloudTranscriptionBetaPanel />
        <TranscriptionModelsPanel />
        <AppearancePanel changed={themeChanged} />
        <PairingPanel state={connectionState} changed={setConnectionState} checkDesktop={refreshConnectionState} />
        {codexEnabled && <CodexSettingsPanel key={language} />}
        <DesktopBackupPanel changed={refreshPendingCaptureCount} connectionState={connectionState} />
        <NotesBackupPanel key={language} changed={refreshPendingCaptureCount} />
        {directUpdatesEnabled && <UpdatePanel availableUpdate={availableUpdate} checkingFinished={setAvailableUpdate} install={startUpdate} installing={installingUpdate} />}
        <Text style={styles.footer}>{t('app.phone_only_notes_stay_encrypted_synced_memory')}</Text>
      </ScrollView>}
    </View>
    <BottomNavigation active={activeTab} select={tab => {
      if (tab === 'ask' && !codexEnabled) {
        setPlansOpen(true)
        return
      }
      if (tab !== 'library') videoRecovery.cancel()
      setActiveTab(tab)
      if (tab === 'add') setCaptureNotice(null)
    }} />
    {!codexEnabled && <PlansPage close={() => setPlansOpen(false)} visible={plansOpen} />}
    <InAppNotice message={taskNotice} dismiss={() => setTaskNotice(null)} dismissLabel={t('common.close')} />
    <UpdateProgressModal progress={updateDownload?.progress ?? 0} visible={installingUpdate} />
  </SafeAreaView>
}

export default function App({ quickCapture = false, quickCaptureText = null, quickCaptureFileUri = null, quickCaptureFileName = null, quickCaptureFileSize = null, quickCaptureFileMimeType = null }: { readonly quickCapture?: boolean; readonly quickCaptureText?: string | null; readonly quickCaptureFileUri?: string | null; readonly quickCaptureFileName?: string | null; readonly quickCaptureFileSize?: number | null; readonly quickCaptureFileMimeType?: string | null }) {
  const sharedFile = quickCaptureFileUri && quickCaptureFileName && quickCaptureFileSize ? { uri: quickCaptureFileUri, filename: quickCaptureFileName, size: quickCaptureFileSize } : null
  const initialPdf = sharedFile && quickCaptureFileMimeType === 'application/pdf' ? sharedFile : null
  const initialImage = sharedFile && imageMediaType(quickCaptureFileMimeType) ? { ...sharedFile, mediaType: quickCaptureFileMimeType } : null
  const sharedMediaKind = sharedFile ? transcriptionMediaKind(quickCaptureFileMimeType, sharedFile.filename) : null
  const initialAudio = sharedFile && sharedMediaKind ? { ...sharedFile, mediaType: quickCaptureFileMimeType ?? `${sharedMediaKind}/*` } : null
  const [language, setLanguage] = useState<Language | null>(null)
  const [themeVersion, setThemeVersion] = useState(0)
  useEffect(() => { void Promise.all([loadLanguage(), loadTheme()]).then(([loaded]) => setLanguage(loaded)) }, [])
  if (!language) return null
  return <SafeAreaProvider><BaselineScreen key={themeVersion} language={language} languageChanged={setLanguage} themeChanged={() => setThemeVersion(version => version + 1)} initialAudio={initialAudio} initialImage={initialImage} initialPdf={initialPdf} initialQuickCapture={quickCapture} initialQuickCaptureText={quickCaptureText} /></SafeAreaProvider>
}
