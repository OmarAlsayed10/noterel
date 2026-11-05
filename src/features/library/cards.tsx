import { capturePresentation } from './capturePresentation'
import { captureReading } from './captureReading'
import { captureRecoveryMenu, CapturePreparationRecovery, type VideoRecoveryActions } from './CapturePreparationRecovery'
import { safeHttpUrl } from '../../links'
import { referenceCapture } from '../../capture/incomingShare'
import { captureCopy } from '../capture/captureCopy'
import { SearchText } from './SearchText'
import { Pressable, Text, View } from 'react-native'
import { unreadableImageMessage } from '../../capture/readability'
import { styles } from '../../theme/styles'
import { CardMenu, ExtractionProgressBar } from '../../components/shared'
import { Button } from '../../components/ui'
import type { PendingImage } from '../../capture/imageImports'
import type { QueuedCapture } from '../../capture/outbox'
import type { PendingPdf } from '../../capture/pdfImports'
import type { PendingDesktopEdit } from '../../notes/pendingEdits'
import type { LocalExtractionProgress, LocalSourceArtifactSummary } from '../../sources/artifacts'
import type { CardMenuOption, SelectedAskMemory } from '../../types'
import type { DesktopLibraryCard, DownloadedLibraryCard, ReadingMemory } from './types'
import { t, tm } from '../../i18n'

interface CardActions {
  readonly onAsk: ((memory: SelectedAskMemory) => void) | null
  readonly read: (memory: ReadingMemory) => void
}

export function ImageCard({ image, mailboxId, onAsk, read, retry, send, remove, openSettings }: CardActions & { readonly image: PendingImage; readonly mailboxId: string | null; readonly retry: () => void; readonly send: () => void; readonly remove: () => void; readonly openSettings: () => void }) {
  const needsDesktop = image.state === 'needs_attention' && !mailboxId && image.failureMessage === unreadableImageMessage
  const processing = image.state === 'queued' || image.state === 'processing'
  const status = image.desktopSourceId ? t('library.on_desktop_phone_copy_retained') : image.state === 'ready' ? t('library.ready_on_this_phone') : image.state === 'needs_attention' ? (image.failureMessage && tm(image.failureMessage)) || t('library.image_recognition_failed_retry_from_menu') : `${tm(image.progressStage)} · ${image.progressPercent}%`
  const options: CardMenuOption[] = [
    ...(image.state === 'needs_attention' ? [{ label: t('library.retry_image_recognition'), action: retry }] : []),
    ...(image.text && onAsk ? [{ label: t('library.ask_about_this'), action: () => onAsk({ sourceId: `phone:${image.id}`, title: image.filename, text: image.text }) }] : []),
    ...(mailboxId && (image.state === 'ready' || image.state === 'needs_attention') && !image.desktopSourceId ? [{ label: image.state === 'needs_attention' ? t('library.recognize_on_desktop') : t('library.send_to_desktop'), action: send }] : []),
    { label: t('library.delete_from_phone'), action: remove, destructive: true }
  ]
  return <View style={styles.libraryCard}><Pressable accessibilityRole="button" disabled={!image.text} onPress={() => read({ sourceId: null, localSourceId: image.id, captureId: null, title: image.filename, text: image.text, kind: 'image', projectId: null, updatedAt: null, stale: false, url: null })} style={styles.libraryCardRead}><View style={styles.libraryCardCopy}><Text numberOfLines={2} style={styles.capabilityName}>{image.filename}</Text><Text numberOfLines={2} style={styles.capabilityDetail}>{image.text || t('library.readable_text_will_appear_when_recognition_finishes')}</Text>{processing && <ExtractionProgressBar progress={{ sourceId: image.id, state: 'processing', percent: image.progressPercent, stage: image.progressStage, failureMessage: null }} />}{!processing && <Text numberOfLines={1} style={[styles.cacheState, image.state === 'needs_attention' && styles.cacheStateFailed]}>{status}</Text>}{needsDesktop && <Pressable accessibilityRole="button" onPress={openSettings} style={styles.openLinkButton}><Text style={styles.openLinkText}>{t('library.pair_with_kestrel_desktop_for_stronger_recognition')}</Text></Pressable>}</View></Pressable><CardMenu label={image.filename} options={options} /></View>
}

export function PdfCard({ pdf, artifact, progress, mailboxId, onAsk, read, process, send, remove }: CardActions & { readonly pdf: PendingPdf; readonly artifact: LocalSourceArtifactSummary | undefined; readonly progress: LocalExtractionProgress | undefined; readonly mailboxId: string | null; readonly process: () => void; readonly send: () => void; readonly remove: () => void }) {
  const status = artifact?.desktopSourceId ? t('library.on_desktop_phone_copy_retained') : artifact?.state === 'needs_attention' ? t('common.send_interrupted_retry_from_menu') : artifact ? t('library.ready_on_phone_tap_to_read_full') : progress?.state === 'needs_attention' ? (progress.failureMessage && tm(progress.failureMessage)) || t('library.pdf_recognition_failed_retry_from_menu') : progress ? `${tm(progress.stage)} · ${progress.percent}%` : pdf.state === 'needs_attention' ? t('library.desktop_import_failed_retry_from_menu') : pdf.destinationMailboxId ? t('common.waiting_for_desktop') : t('library.not_processed_yet')
  const options: CardMenuOption[] = [
    ...(!progress || progress.state === 'needs_attention' ? [{ label: artifact ? t('library.reprocess_pdf_on_this_phone') : progress ? t('library.retry_pdf_processing') : t('library.process_on_this_phone'), action: process }] : []),
    ...(artifact && onAsk ? [{ label: t('library.ask_about_this'), action: () => onAsk({ sourceId: `phone:${pdf.id}`, title: artifact.title, text: artifact.text }) }] : []),
    ...(mailboxId && !artifact?.desktopSourceId ? [{ label: pdf.state === 'needs_attention' || artifact?.state === 'needs_attention' ? t('library.retry_send_to_desktop') : t('library.send_to_desktop'), action: send }] : []),
    { label: t('library.delete_from_phone'), action: remove, destructive: true }
  ]
  return <View style={styles.libraryCard}><Pressable accessibilityRole="button" disabled={!artifact} onPress={() => artifact && read({ sourceId: null, localSourceId: pdf.id, captureId: null, title: artifact.title, text: artifact.text, kind: 'pdf', projectId: null, updatedAt: null, stale: false, url: null })} style={styles.libraryCardRead}><View style={styles.libraryCardCopy}><Text numberOfLines={2} style={styles.capabilityName}>{pdf.filename}</Text><Text numberOfLines={2} style={styles.capabilityDetail}>{artifact?.text ?? `${(pdf.byteLength / 1024 / 1024).toFixed(1)} MiB`}</Text>{progress?.state === 'processing' && <ExtractionProgressBar progress={progress} />}{progress?.state !== 'processing' && <Text numberOfLines={1} style={[styles.cacheState, (pdf.state === 'needs_attention' || artifact?.state === 'needs_attention' || progress?.state === 'needs_attention') && styles.cacheStateFailed]}>{status}</Text>}</View></Pressable><CardMenu label={pdf.filename} options={options} /></View>
}

export function ConflictCard({ edit, activeMailboxId = null, resolve }: { readonly edit: PendingDesktopEdit; readonly activeMailboxId?: string | null; readonly resolve: (choice: 'desktop' | 'phone' | 'copy' | 'edit') => void }) {
  const sameDesktop = edit.destinationMailboxId !== null && edit.destinationMailboxId === activeMailboxId
  return <View style={styles.conflictCard}>
    <Text style={styles.sourceLabel}>{t('library.conflict_title')}</Text>
    <Text numberOfLines={2} style={styles.capabilityName}>{edit.title || t('library.edited_note')}</Text>
    <Text style={styles.capabilityDetail}>{t(!sameDesktop ? 'library.desktop_note_unverified_desktop' : edit.tooLarge ? 'library.desktop_note_too_large' : 'library.this_note_changed_on_both_the_phone')}</Text>
    <View style={styles.conflictActions}>
      <Button label={t('common.edit')} onPress={() => resolve('edit')} />
      {!edit.copyTooLarge && <Button label={t('library.keep_both')} onPress={() => resolve('copy')} variant="secondary" />}
      <Button label={t(sameDesktop ? 'library.keep_desktop' : 'library.discard_phone_edit')} onPress={() => resolve('desktop')} variant="secondary" />
      {sameDesktop && !edit.tooLarge && <Button label={t('library.keep_phone')} onPress={() => resolve('phone')} variant="secondary" />}
    </View>
  </View>
}

export function CaptureCard({ query = '', capture, artifact, progress, mailboxId, onAsk, read, edit, retryLink, sendToDesktop, retrySend, discard, recovery }: CardActions & { readonly query?: string; readonly capture: QueuedCapture; readonly artifact: LocalSourceArtifactSummary | undefined; readonly progress: LocalExtractionProgress | undefined; readonly mailboxId: string | null; readonly edit: () => void; readonly retryLink: () => void; readonly sendToDesktop: () => void; readonly retrySend: () => void; readonly discard: () => void; readonly recovery?: VideoRecoveryActions }) {
  const { title, readableText, status } = capturePresentation(capture, artifact, progress, mailboxId)
  const canPrepare = capture.kind === 'url' && !artifact && !capture.destinationMailboxId && progress?.state !== 'processing'
  const options: CardMenuOption[] = [
    { label: t('common.edit'), action: edit },
    ...(readableText && onAsk ? [{ label: t('library.ask_about_this'), action: () => onAsk({ sourceId: `phone:${capture.id}`, title, text: readableText }) }] : []),
    ...(canPrepare && recovery ? captureRecoveryMenu({ url: capture.payload.text, captureId: capture.id, retry: retryLink, recovery }) : canPrepare ? [{ label: referenceCapture(capture.payload) ? captureCopy('prepareAction') : t('library.retry_link_processing'), action: retryLink }] : []),
    ...(mailboxId && !artifact?.desktopSourceId && capture.destinationMailboxId !== mailboxId ? [{ label: capture.destinationMailboxId ? t('library.move_to_this_desktop') : t('library.send_to_desktop'), action: sendToDesktop }] : []),
    ...((capture.state === 'retry_wait' || capture.state === 'needs_attention') && capture.destinationMailboxId === mailboxId ? [{ label: t('library.retry_send_to_desktop'), action: retrySend }] : []),
    { label: capture.destinationMailboxId ? t('library.discard_pending_send') : t('library.delete_from_phone'), action: discard, destructive: true }
  ]
  return <View style={[styles.libraryCard, { alignItems: 'stretch', flexDirection: 'column' }]}>
    <View style={styles.desktopLibraryCardRow}>
    <Pressable accessibilityRole="button" disabled={!readableText} onPress={() => read(captureReading(capture, artifact, { title, text: readableText, query }))} style={({ pressed }) => [styles.libraryCardRead, pressed && styles.libraryCardPressed]}>
      <View style={styles.libraryCardCopy}>
        <Text numberOfLines={2} style={styles.capabilityName}><SearchText text={title} query={query} /></Text>
        <Text numberOfLines={2} style={styles.capabilityDetail}>{readableText || (progress?.state === 'processing' ? t('library.readable_content_will_appear_when_processing_finishes') : t('library.readable_content_is_not_available_yet'))}</Text>
        {progress?.state === 'processing' && <ExtractionProgressBar progress={progress} />}
        {progress?.state !== 'processing' && <Text style={[styles.cacheState, (capture.state === 'needs_attention' || artifact?.state === 'needs_attention' || progress?.state === 'needs_attention' || !readableText && !progress) && styles.cacheStateFailed]}>{status}</Text>}
      </View>
    </Pressable>
    <CardMenu label={title} options={options} />
    </View>
    {canPrepare && recovery && <CapturePreparationRecovery url={capture.payload.text} captureId={capture.id} failureMessage={progress?.state === 'needs_attention' ? progress.failureMessage ?? t('library.link_extraction_failed_retry_from_menu') : null} retry={retryLink} recovery={recovery} />}
  </View>
}

export function DesktopCard({ query = '', desktop, downloaded, busy, selectionMode, selected, pendingEdit, ask, open, download, select, removeDownload, deleteEverywhere }: { readonly query?: string; readonly desktop: DesktopLibraryCard | null; readonly downloaded: DownloadedLibraryCard | null; readonly busy: boolean; readonly selectionMode: boolean; readonly selected: boolean; readonly pendingEdit: PendingDesktopEdit | undefined; readonly ask: (() => void) | null; readonly open: () => void; readonly download: () => void; readonly select: () => void; readonly removeDownload: () => void; readonly deleteEverywhere: () => void }) {
  const title = downloaded && !downloaded.stale ? downloaded.title : desktop?.title ?? downloaded?.title ?? t('library.untitled_memory')
  const canDownload = Boolean(desktop?.downloadEligible && !pendingEdit)
  const canRefresh = Boolean(downloaded?.stale && canDownload)
  const status = pendingEdit ? pendingEdit.state === 'conflict' ? t('library.resolve_edit_conflict_above') : t('library.changes_waiting_for_desktop') : downloaded ? downloaded.stale ? t('library.available_offline_newer_desktop_version') : t('library.available_offline') : desktop?.downloadEligible ? t('library.ready_to_download') : t('library.desktop_only')
  const options: CardMenuOption[] = [
    ...((desktop || downloaded) && ask ? [{ label: t('library.ask_about_this'), action: ask }] : []),
    ...(canDownload && !downloaded && !busy ? [{ label: t('library.download_to_phone'), action: download }] : []),
    ...(canRefresh && !busy ? [{ label: t('library.refresh_latest'), action: download }] : []),
    ...(downloaded ? [{ label: t('library.remove_phone_download'), action: removeDownload, destructive: true }] : []),
    ...(desktop ? [{ label: t('library.delete_everywhere'), action: deleteEverywhere, destructive: true }] : [])
  ]
  return <View style={[styles.libraryCard, styles.desktopLibraryCard, selected && styles.libraryCardSelected]}>
    <View style={styles.desktopLibraryCardRow}>
      <Pressable accessibilityLabel={`${title}. ${status}`} accessibilityRole="button" accessibilityState={{ selected, disabled: busy || !downloaded && !canDownload, busy }} disabled={busy || !downloaded && !canDownload} onLongPress={canDownload && !downloaded ? select : undefined} onPress={canDownload && !downloaded && selectionMode ? select : downloaded ? open : download} style={({ pressed }) => [styles.libraryCardRead, pressed && styles.libraryCardPressed]}>
        <View style={styles.libraryCardCopy}>
          <Text style={styles.sourceLabel}>{downloaded ? t('library.source_phone') : t('library.source_desktop')}</Text>
          <Text numberOfLines={2} style={styles.capabilityName}>{selected ? '✓ ' : ''}<SearchText text={title} query={query} /></Text>
          <Text numberOfLines={2} style={styles.capabilityDetail}>{desktop?.folderName ? `${desktop.folderName}${desktop.relativePath ? ` · ${desktop.relativePath}` : ''}` : desktop?.url ? `${safeHttpUrl(desktop.url)?.host ?? t('common.link')} · ${downloaded?.excerpt || t('library.open_to_read_imported_content')}` : downloaded?.excerpt || `${desktop?.kind ?? t('common.memory')} · ${Math.ceil((desktop?.byteLength ?? 0) / 1024)} KB`}</Text>
          <Text accessibilityLiveRegion="polite" style={[styles.cacheState, downloaded && !downloaded.stale && !pendingEdit && styles.cacheStateReady, (downloaded?.stale || pendingEdit) && styles.staleState]}>{busy ? canRefresh ? t('library.refreshing') : downloaded ? t('common.opening') : t('library.downloading') : status}</Text>
        </View>
      </Pressable>
      <CardMenu label={title} options={options} />
    </View>
    <View style={styles.libraryCardActionRow}>
      {canDownload && !downloaded && <Button label={t('library.download_to_phone')} onPress={download} busy={busy} />}
      {downloaded && <Button label={t('library.open_downloaded')} onPress={open} disabled={busy} variant="secondary" />}
      {canRefresh && <Button label={busy ? t('library.refreshing') : t('library.refresh_latest')} onPress={download} busy={busy} />}
    </View>
  </View>
}
