import { loadLocalLibrary } from './loadLocalLibrary'
import { LibrarySearch } from './LibrarySearch'
import { LibraryNavigation } from './LibraryNavigation'
import { searchTerms } from '../../library/searchText'
import { emptyLibraryFilters, type LibraryFilters } from '../../library/searchQuery'
import { LibraryFiltersPanel } from './LibraryFiltersPanel'
import { deliverQueuedCaptures } from '../../capture/deliver'
import { refreshDesktopLibrary } from './refreshDesktopLibrary'
import { relatedMemories } from './relatedMemories'
import { discardPendingImage, pendingImageProgress, retryPendingImage, sendPendingImage } from '../../capture/imageImports'
import { assignQueuedCapture, discardQueuedCapture, enqueueCapture, retryQueuedCapture } from '../../capture/outbox'
import { discardPendingPdf, sendPendingPdf } from '../../capture/pdfImports'
import { connectCompanion, currentMailboxId } from '../../companion/client'
import { removeDownloadedSource } from '../../library/downloads'
import { currentDesktopCard, downloadSource, listDesktopLibrary, localLibraryByIds, readDownloadedSource } from '../../library/library'
import { cachedAtlas, refreshAtlas } from '../../nodes/atlas'
import { deleteDesktopMemory } from '../../notes/deletion'
import { pendingDesktopEdits, queueDesktopEdit, removeDesktopEdit, syncDesktopEdits } from '../../notes/pendingEdits'
import { conflictPhoneCopy } from '../../notes/conflictCopy'
import { sendLocalSourceArtifact } from '../../sources/artifactTransfer'
import { localExtractionProgress, localSourceArtifactSummaries, queueLocalPdfProcessing, queueLocalWebpageProcessing, refreshSavedSocialPosts, retryLocalPdfProcessing, retryLocalWebpageProcessing } from '../../sources/artifacts'
import { localRelationships } from '../../sources/relationships'
import { styles } from '../../theme/styles'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Alert, AppState, BackHandler, Pressable, ScrollView, Text, View } from 'react-native'
import type { PendingImage } from '../../capture/imageImports'
import type { QueuedCapture } from '../../capture/outbox'
import type { PendingPdf } from '../../capture/pdfImports'
import type { MobileAtlas } from '../../nodes/atlas'
import type { PendingDesktopEdit } from '../../notes/pendingEdits'
import type { LocalExtractionProgress, LocalSourceArtifactSummary } from '../../sources/artifacts'
import type { ConnectionState, SelectedAskMemory } from '../../types'
import { ScreenHeading } from '../../components/shared'
import { InAppNotice } from '../../components/ui'
import { CaptureCard, ConflictCard, DesktopCard, ImageCard, PdfCard } from './cards'
import { DesktopNoteEditor } from './DesktopNoteEditor'
import { ExtractedTextEditor } from './ExtractedTextEditor'
import { ReaderScreen } from './ReaderScreen'
import { libraryPageSize } from './types'
import type { DesktopLibraryCard, DownloadedLibraryCard, LibraryPageSize, LibraryScope, ReadingMemory } from './types'
import { ManualCapturePanel } from '../../features/capture/CapturePanels'
import { AudioTranscriptionJobsPanel } from '../../features/capture/AudioTranscriptionPanel'
import type { VideoRecoveryActions } from './CapturePreparationRecovery'
import { t, tf, errorText, currentLanguage } from '../../i18n'

const desktopPages = new Map<string, { readonly items: readonly DesktopLibraryCard[]; readonly totalItems: number }>()

export function LibraryPanel({ active, connectionState, desktopUnavailable, localRevision, onAsk, onOpenSettings, onOpenTranscript, videoRecovery }: { readonly active: boolean; readonly connectionState: ConnectionState; readonly desktopUnavailable: () => void; readonly localRevision: number; readonly onAsk: ((memory: SelectedAskMemory) => void) | null; readonly onOpenSettings: () => void; readonly onOpenTranscript: (jobId: string) => void; readonly videoRecovery: VideoRecoveryActions }) {
  const [searchText, setSearchText] = useState('')
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState<LibraryFilters>(emptyLibraryFilters)
  const [collections, setCollections] = useState<readonly string[]>([])
  const filterKey = JSON.stringify(filters)
  const [desktopCards, setDesktopCards] = useState<readonly DesktopLibraryCard[]>([])
  const [downloadedCards, setDownloadedCards] = useState<readonly DownloadedLibraryCard[]>([])
  const [pendingCaptures, setPendingCaptures] = useState<readonly QueuedCapture[]>([])
  const [pdfImports, setPdfImports] = useState<readonly PendingPdf[]>([])
  const [imageImports, setImageImports] = useState<readonly PendingImage[]>([])
  const [mailboxId, setMailboxId] = useState<string | null>(null)
  const [editingCapture, setEditingCapture] = useState<QueuedCapture | null>(null)
  const [editingArtifact, setEditingArtifact] = useState<LocalSourceArtifactSummary | null>(null)
  const [editingDesktop, setEditingDesktop] = useState(false)
  const [learningEditing, setLearningEditing] = useState(false)
  const [reading, setReading] = useState<ReadingMemory | null>(null)
  const [localRelated, setLocalRelated] = useState<{ readonly sourceId: string; readonly ids: readonly string[] } | null>(null)
  const [busySourceId, setBusySourceId] = useState<string | null>('library')
  const [message, setMessage] = useState(t('library.opening_encrypted_memories_on_this_phone'))
  const [taskNotice, setTaskNotice] = useState<string | null>(null)
  const [atlas, setAtlas] = useState<MobileAtlas | null>(null)
  const [desktopEdits, setDesktopEdits] = useState<readonly PendingDesktopEdit[]>([])
  const [artifacts, setArtifacts] = useState<ReadonlyMap<string, LocalSourceArtifactSummary>>(new Map())
  const [extractionProgress, setExtractionProgress] = useState<ReadonlyMap<string, LocalExtractionProgress>>(new Map())
  const [requestedPage, setPage] = useState(0)
  const [pageSize, setPageSize] = useState<LibraryPageSize>(libraryPageSize)
  const [phoneTotal, setPhoneTotal] = useState(0)
  const [downloadedTotal, setDownloadedTotal] = useState(0)
  const [desktopTotal, setDesktopTotal] = useState(0)
  const [selectedSourceIds, setSelectedSourceIds] = useState<ReadonlySet<string>>(new Set())
  const mounted = useRef(true)
  const libraryScroll = useRef<ScrollView>(null)
  const libraryLoadVersion = useRef(0)
  const localLoadVersion = useRef(0)
  const libraryLoading = useRef(false)
  const readerState = useRef({ reading, editing: editingDesktop || !!editingCapture || !!editingArtifact || learningEditing })
  useLayoutEffect(() => { readerState.current = { reading, editing: editingDesktop || !!editingCapture || !!editingArtifact || learningEditing } }, [reading, editingDesktop, editingCapture, editingArtifact, learningEditing])
  const invalidateVideoRecovery = videoRecovery.invalidate
  useLayoutEffect(() => { if (reading || editingCapture || editingArtifact || editingDesktop) invalidateVideoRecovery() }, [reading, editingCapture, editingArtifact, editingDesktop, invalidateVideoRecovery])
  const refreshedXPosts = useRef(false)
  const [scope, setScope] = useState<LibraryScope>('all')
  const [scopeOpen, setScopeOpen] = useState(false)
  const activeQuery = query
  const showPhone = scope !== 'desktop'
  const showDesktop = scope !== 'phone'
  const desktopAvailable = showDesktop && connectionState === 'connected'
  const totalPages = Math.max(1, Math.ceil(((showPhone ? phoneTotal : 0) + (desktopAvailable ? desktopTotal : downloadedTotal)) / pageSize))
  const page = Math.min(requestedPage, totalPages - 1)
  useEffect(() => { libraryScroll.current?.scrollTo({ y: 0, animated: false }) }, [page, pageSize, query, scope, filterKey])
  const refreshLocalLibrary = useCallback(async (desktopSourceIds: readonly string[] = desktopPages.get(`${mailboxId}|${activeQuery}|${page}|${pageSize}|${scope}|${phoneTotal}|${filterKey}`)?.items.map(card => card.sourceId) ?? []) => {
    const version = ++localLoadVersion.current
    const local = await loadLocalLibrary({ query: activeQuery, page, pageSize, scope, desktopAvailable, filters, desktopSourceIds })
    if (!mounted.current || version !== localLoadVersion.current) return local
    if (local.mailboxId !== mailboxId) { setDesktopCards([]); setDesktopTotal(0) }
    setCollections(local.collections)
    setDownloadedCards(local.visibleDownloads)
    setPendingCaptures(local.captures)
    setMailboxId(local.mailboxId)
    setDesktopEdits(local.edits)
    setPdfImports(local.pdfs)
    setImageImports(local.images)
    setPhoneTotal(local.phoneTotal)
    setDownloadedTotal(local.downloadedTotal)
    setArtifacts(local.summaries)
    setExtractionProgress(local.progress)
    return local
  }, [activeQuery, page, pageSize, scope, desktopAvailable, phoneTotal, mailboxId, filters, filterKey])
  const closeReader = useCallback(() => {
    setLearningEditing(false)
    setReading(null)
    void refreshLocalLibrary().catch(error => setTaskNotice(errorText(error, 'library.the_encrypted_memories_on_this_phone_could')))
  }, [refreshLocalLibrary])
  const loadLibrary = useCallback(() => {
    if (readerState.current.editing) return
    const version = ++libraryLoadVersion.current
    const currentLoad = () => mounted.current && version === libraryLoadVersion.current
    libraryLoading.current = true
    const load = async () => {
      const local = await refreshLocalLibrary()
      if (!currentLoad()) return
      if (connectionState !== 'connected') {
        setDesktopCards([])
        setDesktopTotal(0)
        setMessage(!showDesktop ? t('library.showing_memories_stored_on_this_phone') : connectionState === 'offline' ? t('library.desktop_is_offline_showing_memories_stored_on') : t('library.showing_memories_stored_on_this_phone'))
        return
      }
      const pageKey = `${await currentMailboxId()}|${activeQuery}|${page}|${pageSize}|${scope}|${local.phoneTotal}|${filterKey}`
      const cached = showDesktop ? desktopPages.get(pageKey) : undefined
      if (cached) {
        setDesktopCards(cached.items)
        setDesktopTotal(cached.totalItems)
        setMessage(t('library.showing_the_last_copy_from_desktop'))
        setBusySourceId(null)
      }
      let connection: Awaited<ReturnType<typeof connectCompanion>>
      try {
        connection = await connectCompanion()
      } catch (error) {
        if (!currentLoad()) return
        desktopUnavailable()
        setMessage(`${t('library.desktop_did_not_respond')}${error instanceof Error ? `: ${error.message}` : ''}. ${t('library.showing_memories_stored_on_this_phone')}`)
        return
      }
      let visibleDesktopSourceIds: readonly string[] = cached?.items.map(card => card.sourceId) ?? []
      let desktopResponded = false
      try {
        const refreshed = await refreshDesktopLibrary({
          connection, query: activeQuery, page, pageSize, phoneTotal: local.phoneTotal, scope, filters, isCurrent: currentLoad,
          publishListing: listing => {
            desktopResponded = true
            visibleDesktopSourceIds = listing.items.map(card => card.sourceId)
            if (showDesktop) desktopPages.set(pageKey, listing)
            setDesktopCards(listing.items)
            setDesktopTotal(listing.totalItems)
          }
        })
        if (!refreshed || !currentLoad()) return
        const { listing, replacements, failures } = refreshed
        if (failures.length > 0) setTaskNotice(errorText(failures[0], 'library.refresh_partially_completed'))
        visibleDesktopSourceIds = listing.items.map(card => card.sourceId)
        const readingId = readerState.current.reading?.sourceId
        const pendingEdits = await pendingDesktopEdits()
        if (!currentLoad()) return
        if (readingId && readerState.current.reading?.desktopMailboxId === connection.mailboxId && !readerState.current.editing && !pendingEdits.some(edit => edit.sourceId === readingId)) {
          let source = await readDownloadedSource(replacements.get(readingId) ?? readingId)
          if (!source) source = await readDownloadedSource((await currentDesktopCard(connection, readingId)).sourceId)
          if (source && currentLoad() && !readerState.current.editing) setReading(current => current?.sourceId === readingId ? { ...current, sourceId: source.metadata.sourceId, title: source.metadata.title, text: source.text, sourceSegments: source.metadata.moments, updatedAt: source.metadata.updatedAt, projectId: source.metadata.projectId, stale: source.stale } : current)
        }
        if (!currentLoad()) return
        if (showDesktop) desktopPages.set(pageKey, { items: listing.items, totalItems: listing.totalItems })
        setDesktopCards(listing.items)
        setDesktopTotal(listing.totalItems)
        setMessage(t(failures.length > 0 ? 'library.refresh_partially_completed' : 'library.desktop_and_phone_memories_are_ready'))
      } catch (error) {
        if (!currentLoad()) return
        if (desktopResponded) {
          setMessage(t('library.refresh_partially_completed'))
          setTaskNotice(errorText(error, 'library.download_could_not_be_completed'))
        } else {
          setMessage(`${t('library.desktop_did_not_answer')}${error instanceof Error ? `: ${error.message}` : ''}. ${cached ? t('library.showing_the_last_copy_from_desktop') : t('library.showing_memories_stored_on_this_phone')}`)
          if (!cached) desktopUnavailable()
        }
      } finally {
        connection.close()
      }
      if (currentLoad()) await refreshLocalLibrary(visibleDesktopSourceIds)
    }
    void load().catch(() => { if (currentLoad()) setMessage(t('library.the_encrypted_memories_on_this_phone_could')) }).finally(() => { if (currentLoad()) { libraryLoading.current = false; setBusySourceId(current => current === 'library' ? null : current) } })
  }, [activeQuery, connectionState, desktopUnavailable, page, pageSize, refreshLocalLibrary, scope, showDesktop, filters, filterKey])
  const refresh = () => {
    desktopPages.clear()
    setSelectedSourceIds(new Set())
    setBusySourceId('library')
    loadLibrary()
  }
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; libraryLoadVersion.current += 1; localLoadVersion.current += 1 }
  }, [])
  useEffect(() => {
    if (!active || refreshedXPosts.current) return
    refreshedXPosts.current = true
    void refreshSavedSocialPosts().then(({ cleaned, failed }) => {
      if (!mounted.current) return
      if (cleaned > 0) void refreshLocalLibrary()
      if (failed > 0) setTaskNotice(t('library.x_post_cleanup_failed'))
    }).catch(error => { if (mounted.current) setTaskNotice(errorText(error, 'library.x_post_cleanup_failed')) })
  }, [active, refreshLocalLibrary])
  useEffect(() => { desktopPages.clear() }, [localRevision])
  useEffect(() => { desktopPages.clear() }, [mailboxId])
  useEffect(loadLibrary, [loadLibrary, localRevision])
  useEffect(() => {
    if (!active || connectionState !== 'connected') return
    const timer = setInterval(() => { if (!libraryLoading.current && !readerState.current.editing) loadLibrary() }, 15_000)
    return () => clearInterval(timer)
  }, [active, connectionState, loadLibrary])
  useEffect(() => {
    const pendingIds = imageImports.filter(image => image.state === 'queued' || image.state === 'processing').map(image => image.id)
    if (!pendingIds.length) return
    const timer = setInterval(() => {
      void pendingImageProgress(pendingIds).then(updates => setImageImports(current => {
        let changed = false
        const next = current.map(image => {
          const update = updates.get(image.id)
          if (!update || update.state === image.state && update.progressPercent === image.progressPercent && update.progressStage === image.progressStage) return image
          changed = true
          return { ...image, ...update }
        })
        return changed ? next : current
      }))
    }, 750)
    return () => clearInterval(timer)
  }, [imageImports])
  useEffect(() => {
    const processing = [...extractionProgress.values()].some(item => item.state === 'processing')
    if (!processing) return
    const sourceIds = [...extractionProgress.keys()]
    const timer = setInterval(() => {
      void Promise.all([localSourceArtifactSummaries(sourceIds), localExtractionProgress(sourceIds)]).then(([summaries, progress]) => {
        setArtifacts(current => {
          const next = new Map(current)
          sourceIds.forEach(sourceId => next.delete(sourceId))
          summaries.forEach((artifact, sourceId) => next.set(sourceId, artifact))
          return next
        })
        setExtractionProgress(current => {
          const unchanged = current.size === progress.size && [...progress].every(([sourceId, item]) => {
            const previous = current.get(sourceId)
            return previous?.state === item.state && previous.percent === item.percent && previous.stage === item.stage
          })
          return unchanged ? current : progress
        })
      })
    }, 750)
    return () => clearInterval(timer)
  }, [extractionProgress])
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') loadLibrary()
    })
    return () => subscription.remove()
  }, [loadLibrary])
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (editingDesktop) {
        setEditingDesktop(false)
        return true
      }
      if (editingCapture) {
        setEditingCapture(null)
        return true
      }
      if (editingArtifact) {
        setEditingArtifact(null)
        return true
      }
      if (reading && learningEditing) {
        const arabic = currentLanguage() === 'ar'
        Alert.alert(arabic ? 'تغييرات غير محفوظة' : 'Unsaved changes', arabic ? 'تبقى التغييرات هنا حتى تحفظها أو تتجاهلها.' : 'Save your personal notes or discard these changes before leaving.', [{ text: t('common.keep'), style: 'cancel' }, { text: arabic ? 'تجاهل' : 'Discard', style: 'destructive', onPress: closeReader }])
        return true
      }
      if (reading) {
        closeReader()
        return true
      }
      return false
    })
    return () => subscription.remove()
  }, [editingArtifact, editingCapture, editingDesktop, reading, learningEditing, closeReader])
  useEffect(() => {
    if (!reading?.localSourceId) return
    const sourceId = reading.localSourceId
    void localRelationships(sourceId).then(related => setLocalRelated({ sourceId, ids: related.map(item => item.sourceId) })).catch(() => setLocalRelated({ sourceId, ids: [] }))
  }, [reading?.localSourceId])
  useEffect(() => {
    if (!reading?.sourceId) return
    void cachedAtlas().then(cached => setAtlas(cached?.atlas ?? null))
    if (connectionState !== 'connected') return
    void connectCompanion().then(async connection => {
      try {
        setAtlas(await refreshAtlas(connection))
      } finally {
        connection.close()
      }
    }).catch(() => undefined)
  }, [connectionState, reading?.sourceId])
  const discardCapture = (capture: QueuedCapture) => {
    const phoneOnly = capture.destinationMailboxId === null
    Alert.alert(phoneOnly ? t('library.delete_this_phone_only_note') : t('library.discard_this_pending_capture'), phoneOnly ? t('library.this_permanently_removes_the_only_copy_from') : t('library.it_has_not_reached_desktop_discarding_removes'), [
      { text: t('common.keep'), style: 'cancel' },
      { text: phoneOnly ? t('common.delete') : t('common.discard'), style: 'destructive', onPress: () => { if (videoRecovery.pendingUrl === capture.payload.text) videoRecovery.cancel(); void discardQueuedCapture(capture.id).then(() => refreshLocalLibrary()).catch(() => setMessage(t('library.the_phone_note_could_not_be_removed'))) } }
    ])
  }
  const removeDownload = (sourceId: string) => Alert.alert(t('library.remove_this_download'), t('library.the_desktop_memory_remains_available_and_can'), [
    { text: t('common.keep'), style: 'cancel' },
    { text: t('library.remove_download'), style: 'destructive', onPress: () => { void removeDownloadedSource(sourceId).then(() => refreshLocalLibrary()).catch(() => setMessage(t('library.the_offline_download_could_not_be_removed'))) } }
  ])
  const deleteEverywhere = (sourceId: string, title: string) => Alert.alert(t('library.delete_everywhere_2'), tf('library.erase_everywhere_confirm', { title }), [
    { text: t('common.keep'), style: 'cancel' },
    { text: t('library.delete_everywhere'), style: 'destructive', onPress: () => {
      void connectCompanion().then(async connection => {
        try {
          await deleteDesktopMemory(connection, sourceId)
        } finally {
          connection.close()
        }
        setMessage(t('library.the_memory_was_deleted_everywhere'))
        refresh()
      }).catch(error => setMessage(errorText(error, 'library.the_memory_could_not_be_deleted')))
    } }
  ])
  const sendCaptureToCurrentDesktop = (capture: QueuedCapture) => {
    if (!mailboxId) return
    const artifact = artifacts.get(capture.id)
    const moving = capture.destinationMailboxId !== null && capture.destinationMailboxId !== mailboxId
    Alert.alert(moving ? t('library.move_this_capture') : t('library.send_this_capture'), artifact ? t('library.send_the_completed_extraction_to_desktop_desktop') : moving ? t('library.this_capture_was_assigned_to_a_previous') : t('library.send_this_phone_only_capture_to_the'), [
      { text: t('library.keep_on_phone'), style: 'cancel' },
      { text: moving ? t('library.move_and_send') : t('common.send'), onPress: () => {
        setMessage(t('library.preparing_this_capture_for_desktop'))
        const send = artifact
          ? connectCompanion().then(async connection => { try { return await sendLocalSourceArtifact(connection, capture.id, mailboxId) } finally { connection.close() } }).then(receipt => { setMessage(receipt.outcome === 'duplicate' ? t('library.desktop_already_has_identical_content') : t('library.desktop_accepted_the_completed_extraction')) })
          : assignQueuedCapture(capture.id, mailboxId).then(async () => { const result = await deliverQueuedCaptures(); setMessage(result.deliveredOperationIds.includes(capture.id) ? t('library.this_capture_was_accepted_by_desktop') : t('library.this_capture_is_assigned_and_waiting_for')) })
        void send.catch(error => setMessage(errorText(error, 'library.this_capture_could_not_be_assigned'))).finally(() => refreshLocalLibrary())
      } }
    ])
  }
  const retryCapture = (id: string) => {
    setMessage(t('library.retrying_this_capture'))
    void retryQueuedCapture(id).then(async () => {
      const result = await deliverQueuedCaptures()
      setMessage(result.deliveredOperationIds.includes(id) ? t('library.this_capture_was_accepted_by_desktop') : t('library.this_capture_is_still_waiting_for_desktop'))
    }).catch(error => setMessage(errorText(error, 'library.this_capture_could_not_be_retried'))).finally(() => refreshLocalLibrary())
  }
  const retryLinkProcessing = (capture: QueuedCapture) => {
    void queueLocalWebpageProcessing(capture.id, capture.payload.text)
      .then(async () => { await refreshLocalLibrary(); await retryLocalWebpageProcessing(capture.id, capture.payload.text, capture.payload.title, capture.payload.captionLanguage) })
      .catch(error => setTaskNotice(errorText(error, 'library.this_link_could_not_be_queued')))
      .finally(() => refreshLocalLibrary())
  }
  const resolveDesktopEdit = (edit: PendingDesktopEdit, choice: 'desktop' | 'phone' | 'copy' | 'edit') => {
    if (choice === 'edit') {
      setReading({ sourceId: edit.sourceId, desktopMailboxId: edit.destinationMailboxId, localSourceId: null, captureId: null, title: edit.title, text: edit.text, kind: 'manual_note', projectId: edit.projectId, updatedAt: edit.expectedUpdatedAt, stale: false, url: null })
      setEditingDesktop(true)
      return
    }
    const resolve = async () => {
      if (choice === 'desktop') {
        await removeDesktopEdit(edit.sourceId)
      } else if (choice === 'copy') {
        if (edit.copyTooLarge) throw new Error(t('library.desktop_note_too_large'))
        await enqueueCapture(conflictPhoneCopy(edit))
        await removeDesktopEdit(edit.sourceId)
      } else {
        const connection = await connectCompanion()
        try {
          if (!edit.destinationMailboxId || connection.mailboxId !== edit.destinationMailboxId) throw new Error(t('library.the_conflict_could_not_be_resolved'))
          const current = await currentDesktopCard(connection, edit.sourceId)
          await queueDesktopEdit({ sourceId: current.sourceId, destinationMailboxId: edit.destinationMailboxId, title: edit.title, text: edit.text, projectId: edit.projectId, expectedUpdatedAt: current.updatedAt })
          await syncDesktopEdits(connection)
          if ((await pendingDesktopEdits()).some(pending => pending.sourceId === current.sourceId)) throw new Error(t('library.this_note_changed_on_desktop_choose_which'))
        } finally {
          connection.close()
        }
        await removeDesktopEdit(edit.sourceId)
      }
      setMessage(choice === 'desktop' ? t('library.desktop_version_kept') : choice === 'copy' ? t('library.both_versions_were_kept') : t('library.desktop_note_updated_from_the_phone_version'))
      refresh()
    }
    void resolve().catch(error => setMessage(errorText(error, 'library.the_conflict_could_not_be_resolved')))
  }
  const sendPdf = (pdf: PendingPdf) => {
    if (!mailboxId) return
    const artifact = artifacts.get(pdf.id)
    Alert.alert(t('library.send_this_pdf'), artifact ? t('library.send_the_completed_phone_recognition_to_desktop') : t('library.desktop_will_import_extract_and_index_this'), [
      { text: t('library.keep_on_phone'), style: 'cancel' },
      { text: t('common.send'), onPress: () => {
        void connectCompanion().then(async connection => {
          try {
            if (artifact) {
              const receipt = await sendLocalSourceArtifact(connection, pdf.id, mailboxId)
              setMessage(receipt.outcome === 'duplicate' ? t('library.desktop_already_has_identical_content') : t('library.desktop_accepted_the_recognized_pdf'))
            } else {
              await sendPendingPdf(connection, pdf.id, mailboxId)
              setMessage(t('library.desktop_accepted_the_pdf_for_ingestion'))
            }
          } finally {
            connection.close()
          }
          refresh()
        }).catch(error => setMessage(errorText(error, 'library.the_pdf_could_not_be_sent'))).finally(() => refreshLocalLibrary())
      } }
    ])
  }
  const sendImage = (image: PendingImage) => {
    if (!mailboxId) return
    void connectCompanion().then(async connection => {
      try {
        const receipt = await sendPendingImage(connection, image.id)
        setMessage(receipt.outcome === 'duplicate' ? t('library.desktop_already_has_identical_content') : t('library.desktop_accepted_the_recognized_image'))
      } finally {
        connection.close()
      }
    }).catch(error => setMessage(errorText(error, 'library.the_image_could_not_be_sent'))).finally(() => refreshLocalLibrary())
  }
  const processPdf = (pdf: PendingPdf) => {
    const process = artifacts.has(pdf.id) ? retryLocalPdfProcessing(pdf.id) : queueLocalPdfProcessing(pdf.id)
    setMessage(artifacts.has(pdf.id) ? t('library.reprocessing_this_pdf_on_the_phone') : t('library.queued_pdf_processing_on_this_phone'))
    void process.then(() => refreshLocalLibrary()).catch(error => setMessage(errorText(error, 'library.the_pdf_could_not_be_processed')))
  }
  const retryImage = (image: PendingImage) => {
    void retryPendingImage(image.id).then(() => refreshLocalLibrary()).catch(error => setMessage(errorText(error, 'library.this_image_could_not_be_retried')))
  }
  const deleteImage = (image: PendingImage) => Alert.alert(t('library.delete_this_image'), t('library.this_permanently_removes_the_encrypted_image_and'), [
    { text: t('common.keep'), style: 'cancel' },
    { text: t('common.delete'), style: 'destructive', onPress: () => { void discardPendingImage(image.id).then(() => refreshLocalLibrary()) } }
  ])
  const deletePdf = (pdf: PendingPdf) => Alert.alert(t('library.delete_this_pending_pdf'), t('library.this_permanently_removes_the_encrypted_phone_copy'), [
    { text: t('common.keep'), style: 'cancel' },
    { text: t('common.delete'), style: 'destructive', onPress: () => { void discardPendingPdf(pdf.id).then(() => refreshLocalLibrary()) } }
  ])
  const openDownloaded = async (sourceId: string) => {
    const source = await readDownloadedSource(sourceId)
    if (!source) throw new Error(t('library.the_encrypted_local_copy_is_unavailable'))
    const draft = (await pendingDesktopEdits()).find(edit => edit.sourceId === sourceId)
    setReading({ sourceId, searchQuery: query, desktopMailboxId: source.mailboxId, localSourceId: null, captureId: null, title: draft?.title ?? source.metadata.title, text: draft?.text ?? source.text, sourceSegments: source.metadata.moments, kind: source.metadata.kind, mediaType: source.metadata.mediaType ?? null, projectId: draft ? draft.projectId : source.metadata.projectId, updatedAt: draft?.expectedUpdatedAt ?? source.metadata.updatedAt, stale: source.stale, url: source.metadata.url })
  }
  const toggleSelection = (sourceId: string) => setSelectedSourceIds(current => {
    const next = new Set(current)
    if (next.has(sourceId)) next.delete(sourceId)
    else next.add(sourceId)
    return next
  })
  const downloadCards = async (connection: Awaited<ReturnType<typeof connectCompanion>>, cardsToDownload: readonly DesktopLibraryCard[]) => {
    for (const card of cardsToDownload) await downloadSource(connection, card)
  }
  const downloadOne = (desktopCard: DesktopLibraryCard) => {
    if (busySourceId || !desktopCard.downloadEligible) return
    setBusySourceId(desktopCard.sourceId)
    void connectCompanion().then(async connection => {
      try {
        await downloadCards(connection, [desktopCard])
      } finally {
        connection.close()
      }
      setSelectedSourceIds(current => { const next = new Set(current); next.delete(desktopCard.sourceId); return next })
      setMessage(t('library.downloaded_to_phone'))
      await refreshLocalLibrary(desktopCards.map(card => card.sourceId))
    }).catch(error => setMessage(errorText(error, 'library.download_could_not_be_completed'))).finally(() => setBusySourceId(null))
  }
  const listFolderCards = async (connection: Awaited<ReturnType<typeof connectCompanion>>, folderName: string) => {
    const folderCards: DesktopLibraryCard[] = []
    let offset = 0
    while (true) {
      const listing = await listDesktopLibrary(connection, { folder: folderName, limit: 50, offset })
      folderCards.push(...listing.items)
      if (listing.items.length < 50) return folderCards
      offset += listing.items.length
    }
  }
  const downloadFolder = (folderName: string) => {
    if (busySourceId) return
    setBusySourceId('downloads')
    void connectCompanion().then(async connection => {
      try {
        const folderCards = await listFolderCards(connection, folderName)
        const folderDownloads = await localLibraryByIds(folderCards.map(card => card.sourceId), connection.mailboxId)
        const downloadedIds = new Set(folderDownloads.filter(card => !card.stale).map(card => card.sourceId))
        await downloadCards(connection, folderCards.filter(card => !downloadedIds.has(card.sourceId) && card.downloadEligible))
        setMessage(tf('library.downloaded_folder_to_phone', { folder: folderName }))
        await refreshLocalLibrary(desktopCards.map(card => card.sourceId))
      } finally {
        connection.close()
      }
    }).catch(error => setMessage(errorText(error, 'library.download_could_not_be_completed'))).finally(() => setBusySourceId(null))
  }
  const selectedDesktopCards = () => {
    const cardsById = new Map<string, DesktopLibraryCard>()
    desktopPages.forEach(page => page.items.forEach(card => cardsById.set(card.sourceId, card)))
    desktopCards.forEach(card => cardsById.set(card.sourceId, card))
    return [...selectedSourceIds].flatMap(sourceId => {
      const card = cardsById.get(sourceId)
      return card && card.downloadEligible ? [card] : []
    })
  }
  const downloadSelected = () => {
    if (busySourceId || selectedSourceIds.size === 0) return
    const selected = selectedDesktopCards()
    setBusySourceId('downloads')
    void connectCompanion().then(async connection => {
      try {
        for (const card of selected) await downloadSource(connection, card)
      } finally {
        connection.close()
      }
      setSelectedSourceIds(new Set())
      setMessage(tf('library.downloaded_selected_to_phone', { count: selected.length }))
      await refreshLocalLibrary(desktopCards.map(card => card.sourceId))
    }).catch(error => setMessage(errorText(error, 'library.download_could_not_be_completed'))).finally(() => setBusySourceId(null))
  }
  const open = (downloadedCard: DownloadedLibraryCard | null) => {
    if (busySourceId && busySourceId !== 'library') return
    if (!downloadedCard) return
    const libraryIsRefreshing = busySourceId === 'library'
    if (!libraryIsRefreshing) setBusySourceId(downloadedCard.sourceId)
    void openDownloaded(downloadedCard.sourceId).catch(error => {
      const detail = errorText(error, 'library.this_memory_could_not_be_opened')
      setMessage(detail)
      Alert.alert(t('library.could_not_open_memory'), detail)
    }).finally(() => { if (!libraryIsRefreshing) setBusySourceId(null) })
  }
  const connections = relatedMemories(atlas, reading?.sourceId ?? null).filter(node => desktopCards.some(card => card.sourceId === node.sourceId) || downloadedCards.some(card => card.sourceId === node.sourceId)).slice(0, 3)
  const localRelatedIds = localRelated && localRelated.sourceId === reading?.localSourceId ? localRelated.ids : []
  const localConnections = localRelatedIds.flatMap(sourceId => {
    const capture = pendingCaptures.find(item => item.id === sourceId)
    const artifact = artifacts.get(sourceId)
    if (!capture && !artifact) return []
    return [{ sourceId, captureId: capture?.id ?? null, title: artifact?.title || capture?.payload.title || t('library.phone_memory'), text: artifact?.text || (capture?.kind === 'note' ? capture.payload.text : '') || '', kind: artifact?.kind === 'pdf' ? 'pdf' as const : artifact?.kind === 'video' ? 'video' as const : capture?.kind === 'note' ? 'manual_note' as const : 'url' as const, url: artifact?.finalUrl ?? null, transcriptionSource: capture?.payload.transcription?.source, imageUrls: Array.isArray(artifact?.metadata.imageUrls) ? artifact.metadata.imageUrls.filter((url): url is string => typeof url === 'string') : [] }]
  }).slice(0, 3)
  const openConnection = (sourceId: string) => {
    setReading(null)
    open(downloadedCards.find(card => card.sourceId === sourceId) ?? null)
  }
  const askAboutLibraryMemory = (sourceId: string, title: string, downloaded: DownloadedLibraryCard | null) => {
    if (!onAsk) return
    if (!downloaded) {
      onAsk({ sourceId, title, text: null })
      return
    }
    void readDownloadedSource(sourceId).then(source => {
      if (!source) throw new Error(t('library.the_encrypted_local_copy_is_unavailable'))
      onAsk({ sourceId, title, text: source.text })
    }).catch(error => setMessage(errorText(error, 'library.this_memory_could_not_be_selected')))
  }
  const searchLibrary = () => {
    const nextQuery = searchText.trim()
    try { searchTerms(nextQuery) } catch (error) { setMessage(error instanceof Error ? error.message : t('library.search_notes_and_memories')); return }
    if (nextQuery !== query || page !== 0) setBusySourceId('library')
    setSelectedSourceIds(new Set())
    setQuery(nextQuery)
    setPage(0)
  }
  const goToPage = (nextPage: number) => {
    if (nextPage === page) return
    setBusySourceId('library')
    setPage(nextPage)
  }
  const changePageSize = (nextSize: LibraryPageSize) => {
    if (nextSize === pageSize) return
    setPageSize(nextSize)
    setPage(0)
    setSelectedSourceIds(new Set())
    setBusySourceId('library')
  }
  if (editingDesktop && reading?.sourceId && reading.updatedAt && (reading.kind === 'manual_note' || reading.kind === 'pasted_text')) return <DesktopNoteEditor note={{ sourceId: reading.sourceId, destinationMailboxId: reading.desktopMailboxId ?? null, title: reading.title, text: reading.text, projectId: reading.projectId, updatedAt: reading.updatedAt }} cancel={() => setEditingDesktop(false)} saved={notice => { setEditingDesktop(false); setReading(null); setMessage(notice); refresh() }} />
  if (editingArtifact) return <ExtractedTextEditor artifact={editingArtifact} cancel={() => setEditingArtifact(null)} saved={notice => { setEditingArtifact(null); setReading(null); setMessage(notice); refresh() }} />
  if (editingCapture) return <View style={styles.readerScreen}>
    <View style={styles.readerHeader}>
      <Pressable accessibilityLabel={t('library.cancel_editing')} accessibilityRole="button" onPress={() => setEditingCapture(null)} style={styles.backButton}><Text style={styles.backButtonText}>{t('library.cancel')}</Text></Pressable>
      <Text numberOfLines={1} style={styles.readerTitle}>Edit {editingCapture.destinationMailboxId ? 'pending' : 'phone-only'} {editingCapture.kind}</Text>
    </View>
    <ScrollView contentContainerStyle={styles.editorPage}><ManualCapturePanel capture={editingCapture} onNotice={setMessage} onQueueChanged={() => void refreshLocalLibrary()} onSaved={() => { setEditingCapture(null); setReading(null) }} /></ScrollView>
  </View>
  if (reading) return <ReaderScreen learningEditingChanged={setLearningEditing} reading={reading} connections={connections} localConnections={localConnections} back={closeReader} editCapture={reading.captureId ? () => { const artifact = artifacts.get(reading.captureId!); if (artifact) setEditingArtifact(artifact); else { const capture = pendingCaptures.find(item => item.id === reading.captureId); if (capture) setEditingCapture(capture) } } : null} editDesktop={reading.sourceId && (reading.kind === 'manual_note' || reading.kind === 'pasted_text') ? () => setEditingDesktop(true) : null} openConnection={openConnection} openLocal={connection => setReading({ sourceId: null, localSourceId: connection.sourceId, captureId: connection.captureId, title: connection.title, text: connection.text, kind: connection.kind, mediaType: null, imageUrls: connection.imageUrls, transcriptionSource: connection.transcriptionSource, projectId: null, updatedAt: null, stale: false, url: connection.url })} openSettings={onOpenSettings} summarySaved={() => void refreshLocalLibrary()} />
  const desktopIds = new Set(desktopCards.map(card => card.sourceId))
  const downloadedById = new Map(downloadedCards.filter(card => card.mailboxId === mailboxId).map(card => [card.sourceId, card]))
  const visiblePendingCaptures = pendingCaptures
  const visiblePdfImports = pdfImports
  const cards = [
    ...desktopCards.map(card => ({ desktop: card, downloaded: downloadedById.get(card.sourceId) ?? null })),
    ...downloadedCards.filter(card => !desktopIds.has(card.sourceId)).map(card => ({ desktop: null, downloaded: card }))
  ]
  const cardsByFolder = new Map<string, typeof cards>()
  cards.forEach(card => {
    const folder = card.desktop?.folderName ?? card.downloaded?.folderName ?? t('library.other_memories')
    const group = cardsByFolder.get(folder) ?? []
    group.push(card)
    cardsByFolder.set(folder, group)
  })
  return <><View style={styles.content}>
    <LibraryNavigation page={page} totalPages={totalPages} busy={busySourceId !== null} goToPage={goToPage} pageSize={pageSize} changePageSize={changePageSize} />
    <ScrollView ref={libraryScroll} contentContainerStyle={styles.tabPage}>
    <ScreenHeading eyebrow={t('library.notes_eyebrow')} title={t('library.your_notes_and_memories')} summary={t('library.read_phone_only_notes_and_securely_cached')} />
    <AudioTranscriptionJobsPanel enabled={active} open={onOpenTranscript} />
    <View style={styles.panel}>
      <LibrarySearch search={{ text: searchText, change: setSearchText, submit: searchLibrary }} scope={{ selected: scope, choose: next => { setScope(next); setSelectedSourceIds(new Set()); setPage(0); setBusySourceId('library') } }} filters={{ open: scopeOpen, toggle: () => setScopeOpen(open => !open), active: scope !== 'all' || filters.kind !== 'all' || filters.sinceMs !== null || Boolean(filters.collection) || filters.revisitOnly || Boolean(filters.source) }} />
      {scopeOpen && <LibraryFiltersPanel filters={filters} collections={collections} change={next => { setFilters(next); setPage(0); setSelectedSourceIds(new Set()); setBusySourceId('library') }} />}
      <View style={styles.libraryToolbar}>
        <Text style={styles.capabilityDetail}>{message}</Text>
        <View style={styles.libraryToolbarActions}>{selectedSourceIds.size > 0 && <><Pressable accessibilityRole="button" disabled={busySourceId !== null} onPress={downloadSelected} style={styles.refreshButton}><Text style={styles.refreshButtonText}>{tf('library.download_selected', { count: selectedSourceIds.size })}</Text></Pressable><Pressable accessibilityRole="button" disabled={busySourceId !== null} onPress={() => setSelectedSourceIds(new Set())} style={styles.refreshButton}><Text style={styles.refreshButtonText}>{t('library.clear_selection')}</Text></Pressable></>}<Pressable accessibilityLabel={t('library.refresh_library')} accessibilityRole="button" disabled={busySourceId !== null} onPress={refresh} style={styles.refreshButton}><Text style={styles.refreshButtonText}>{busySourceId === 'library' ? t('common.loading') : t('library.refresh')}</Text></Pressable></View>
      </View>
      {showPhone && (imageImports.length > 0 || visiblePdfImports.length > 0 || visiblePendingCaptures.length > 0) && <Text style={styles.librarySectionLabel}>{t('library.on_this_phone')}</Text>}
      {showPhone && imageImports.map(image => <ImageCard key={image.id} image={image} mailboxId={mailboxId} onAsk={onAsk} read={setReading} retry={() => retryImage(image)} send={() => sendImage(image)} remove={() => deleteImage(image)} openSettings={onOpenSettings} />)}
      {showPhone && visiblePdfImports.map(pdf => <PdfCard key={pdf.id} pdf={pdf} artifact={artifacts.get(pdf.id)} progress={extractionProgress.get(pdf.id)} mailboxId={mailboxId} onAsk={onAsk} read={setReading} process={() => processPdf(pdf)} send={() => sendPdf(pdf)} remove={() => deletePdf(pdf)} />)}
      {desktopEdits.filter(edit => edit.state === 'conflict').map(edit => <ConflictCard key={`conflict-${edit.sourceId}`} edit={edit} activeMailboxId={mailboxId} resolve={choice => resolveDesktopEdit(edit, choice)} />)}
      {cards.length === 0 && imageImports.length === 0 && visiblePendingCaptures.length === 0 && visiblePdfImports.length === 0 && busySourceId === null && <Text style={styles.emptyText}>{t('library.no_memories_are_available_yet')}</Text>}
      {showPhone && visiblePendingCaptures.map(capture => <CaptureCard recovery={videoRecovery} key={capture.id} query={query} capture={capture} artifact={artifacts.get(capture.id)} progress={extractionProgress.get(capture.id)} mailboxId={mailboxId} onAsk={onAsk} read={setReading} edit={() => { const artifact = artifacts.get(capture.id); if (artifact) setEditingArtifact(artifact); else setEditingCapture(capture) }} retryLink={() => retryLinkProcessing(capture)} sendToDesktop={() => sendCaptureToCurrentDesktop(capture)} retrySend={() => retryCapture(capture.id)} discard={() => discardCapture(capture)} />)}
      {[...cardsByFolder].map(([folder, folderCards]) => <View key={folder}>
        <View style={styles.libraryFolderHeading}><Text style={styles.librarySectionLabel}>{folder}</Text>{folder !== t('library.other_memories') && <Pressable accessibilityRole="button" disabled={busySourceId !== null} onPress={() => downloadFolder(folder)} style={styles.libraryFolderButton}><Text style={styles.libraryFolderButtonText}>{t('library.download_folder')}</Text></Pressable>}</View>
        {folderCards.map(({ desktop, downloaded }) => {
          const sourceId = desktop?.sourceId ?? downloaded?.sourceId ?? ''
          const title = desktop?.title ?? downloaded?.title ?? t('library.untitled_memory')
          return <DesktopCard key={sourceId} query={query} desktop={desktop} downloaded={downloaded} busy={busySourceId === sourceId || busySourceId === 'downloads'} selectionMode={selectedSourceIds.size > 0} selected={selectedSourceIds.has(sourceId)} pendingEdit={desktopEdits.find(edit => edit.sourceId === sourceId)} ask={onAsk ? () => askAboutLibraryMemory(sourceId, title, downloaded) : null} open={() => open(downloaded)} download={() => desktop && downloadOne(desktop)} select={() => desktop && toggleSelection(desktop.sourceId)} removeDownload={() => downloaded && removeDownload(downloaded.sourceId)} deleteEverywhere={() => desktop && deleteEverywhere(desktop.sourceId, title)} />
        })}
      </View>)}
    </View>
  </ScrollView></View><InAppNotice message={taskNotice} dismiss={() => setTaskNotice(null)} dismissLabel={t('common.close')} /></>
}
