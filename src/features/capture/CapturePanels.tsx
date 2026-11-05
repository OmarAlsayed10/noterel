import { saveCaptureLocally, prepareCapturedSource } from '../../capture/saveCapture'
import { captureCopy } from './captureCopy'
import { videoRecoveryCopy } from './videoRecoveryCopy'
import { LinkCaptureOptions } from './LinkCaptureOptions'
import { LinkCapturePreview } from './LinkCapturePreview'
import { deliverQueuedCaptures } from '../../capture/deliver'
import { safeHttpUrl } from '../../links'
import { normalizeIncomingShare } from '../../capture/incomingShare'
import { assignQueuedCapture } from '../../capture/outbox'
import { savePendingPdf } from '../../capture/pdfImports'
import { chooseFile, type ChosenFile, type FileCategory } from '../../capture/chooseFile'
import { connectCompanion, currentMailboxId } from '../../companion/client'
import { linkedPhoneNote, reconcileDeliveredNotes } from '../../capture/linkedNotes'
import { syncDesktopEdits } from '../../notes/pendingEdits'
import { MarkdownText } from '../../notes/MarkdownText'
import { applyMarkdownFormat } from '../../notes/markdown'
import { queueLocalPdfProcessing } from '../../sources/artifacts'
import { Button } from '../../components/ui'
import { palette, styles } from '../../theme/styles'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Image, Pressable, Text, TextInput, View } from 'react-native'
import type { ImageCandidate } from '../../capture/imageImports'
import type { IncomingShare } from '../../capture/incomingShare'
import type { QueuedCapture } from '../../capture/outbox'
import type { PdfCandidate } from '../../capture/pdfImports'
import type { MarkdownFormat, TextSelection } from '../../notes/markdown'
import { MarkdownToolbar } from '../../components/shared'
import { t, tf, errorText } from '../../i18n'
import { saveNoteImport, type NoteImportCandidate } from '../../imports/noteImports'
import type { AudioCandidate } from '../../transcription/transcription'

export function PdfProcessingPanel({ pdf, finished }: { readonly pdf: PdfCandidate; readonly finished: (message: string) => void }) {
  const started = useRef(false)
  useEffect(() => {
    if (started.current) return
    started.current = true
    void savePendingPdf(pdf).then(async pending => {
      await queueLocalPdfProcessing(pending.id)
      finished(t('capture.pdf_saved_securely_recognition_progress_is_available'))
    }).catch(error => finished(errorText(error, 'common.the_pdf_could_not_be_saved_securely')))
  }, [finished, pdf])
  return <View style={styles.panel}><View style={styles.panelHeading}><View><Text style={styles.eyebrow}>{t('capture.adding_pdf_eyebrow')}</Text><Text style={styles.panelTitle}>{pdf.filename}</Text></View><ActivityIndicator color={palette.accent} /></View><Text style={styles.capabilityDetail}>{t('capture.saving_an_encrypted_copy')}</Text></View>
}

export function SharePanel({ share, discard, state }: { readonly share: IncomingShare; readonly discard: () => void; readonly state: 'review' | 'saving' | 'failed' }) {
  return <View style={styles.sharePanel}>
    <View style={styles.panelHeading}><View><Text style={styles.eyebrow}>{t('capture.adding_to_kestrel_eyebrow')}</Text><Text style={styles.shareTitle}>{share.kind === 'url' ? safeHttpUrl(share.text)?.host ?? t('capture.shared_link') : share.title || t('capture.shared_note')}</Text></View>{state !== 'failed' && <ActivityIndicator color={palette.accent} />}</View>
    <Text style={styles.shareText}>{state === 'failed' ? t('capture.this_share_could_not_be_saved_securely') : share.kind === 'url' ? t('capture.saving_and_extracting_readable_content_on_this') : t('capture.saving_this_note_securely_on_this_phone')}</Text>
    {state === 'failed' && <Pressable accessibilityRole="button" onPress={discard} style={styles.confirmButton}><Text style={styles.confirmButtonText}>{t('common.close')}</Text></Pressable>}
  </View>
}

export function ImageCapturePanel({ image, save, cancel, state, compact }: { readonly image: ImageCandidate; readonly save: () => void; readonly cancel: () => void; readonly state: 'review' | 'saving' | 'failed'; readonly compact: boolean }) {
  return <View style={compact ? styles.quickCaptureCard : styles.panel}>
    <Text style={styles.eyebrow}>{t('capture.add_image_to_kestrel_eyebrow')}</Text>
    <Text style={compact ? styles.quickCaptureTitle : styles.panelTitle}>{image.filename}</Text>
    <Image accessibilityLabel={`${t('capture.preview_of')} ${image.filename}`} resizeMode="contain" source={{ uri: image.uri }} style={styles.imagePreview} />
    <Text style={styles.capabilityDetail}>{(image.size / 1024 / 1024).toFixed(1)} MiB · Text stays on this phone</Text>
    {state === 'failed' && <Text style={styles.quickCaptureError}>{t('capture.could_not_save_this_image_securely')}</Text>}
    <View style={styles.quickCaptureActions}>
      <Pressable accessibilityRole="button" disabled={state === 'saving'} onPress={cancel} style={styles.quickCaptureCancel}><Text style={styles.quickCaptureCancelText}>{t('common.cancel')}</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={state === 'saving'} onPress={save} style={styles.quickCaptureSave}><Text style={styles.quickCaptureSaveText}>{state === 'saving' ? t('common.saving') : t('common.save')}</Text></Pressable>
    </View>
  </View>
}

export function QuickPdfCapturePanel({ pdf, save, cancel, state }: { readonly pdf: PdfCandidate; readonly save: () => void; readonly cancel: () => void; readonly state: 'review' | 'saving' | 'failed' }) {
  return <View style={styles.quickCaptureCard}>
    <Text style={styles.eyebrow}>{t('capture.add_to_kestrel_eyebrow')}</Text>
    <Text style={styles.quickCaptureTitle}>{t('capture.shared_pdf')}</Text>
    <Text style={styles.capabilityDetail}>{pdf.filename} · {(pdf.size / 1024 / 1024).toFixed(1)} MiB</Text>
    {state === 'failed' && <Text style={styles.quickCaptureError}>{t('capture.could_not_save_this_pdf_securely')}</Text>}
    <View style={styles.quickCaptureActions}>
      <Pressable accessibilityRole="button" disabled={state === 'saving'} onPress={cancel} style={styles.quickCaptureCancel}><Text style={styles.quickCaptureCancelText}>{t('common.cancel')}</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={state === 'saving'} onPress={save} style={styles.quickCaptureSave}><Text style={styles.quickCaptureSaveText}>{state === 'saving' ? t('common.saving') : t('common.save')}</Text></Pressable>
    </View>
  </View>
}

export { QuickCapturePanel } from './QuickCapturePanel'

function NoteImportPanel({ candidate, cancel, finished, failed }: { readonly candidate: NoteImportCandidate; readonly cancel: () => void; readonly finished: (count: number) => void; readonly failed: (error: unknown) => void }) {
  const [busy, setBusy] = useState(false)
  const save = () => {
    setBusy(true)
    void saveNoteImport(candidate).then(finished).catch(failed).finally(() => setBusy(false))
  }
  return <View style={styles.noteImportPreview}>
    <Text style={styles.eyebrow}>{candidate.kind === 'anki' ? t('imports.anki_eyebrow') : t('imports.archive_eyebrow')}</Text>
    <Text style={styles.panelTitle}>{candidate.filename}</Text>
    <Text style={styles.capabilityDetail}>{tf('imports.notes_ready', { count: candidate.notes.length })}</Text>
    <View style={styles.noteImportList}>{candidate.notes.slice(0, 5).map((note, index) => <View key={`${candidate.sourcePaths[index]}-${index}`} style={styles.noteImportRow}><Text numberOfLines={1} style={styles.capabilityName}>{note.title ?? t('common.note')}</Text><Text numberOfLines={1} style={styles.capabilityDetail}>{candidate.sourcePaths[index]}</Text></View>)}{candidate.notes.length > 5 && <Text style={styles.capabilityDetail}>{tf('imports.more_notes', { count: candidate.notes.length - 5 })}</Text>}</View>
    <View style={styles.quickCaptureActions}><Button label={t('common.cancel')} onPress={cancel} disabled={busy} variant="secondary" /><Button label={t('imports.import_notes')} onPress={save} busy={busy} /></View>
  </View>
}

export function ManualCapturePanel({ capture, initialCaptureKind = 'note', onChooseAudio, onChooseImage, onChoosePdf, onNotice, onQueueChanged, onSaved }: { readonly capture?: QueuedCapture; readonly initialCaptureKind?: 'note' | 'file'; readonly onChooseAudio?: (audio: AudioCandidate) => void; readonly onChooseImage?: (image: ImageCandidate) => void; readonly onChoosePdf?: (pdf: PdfCandidate) => void; readonly onNotice: (notice: string) => void; readonly onQueueChanged: () => void; readonly onSaved?: () => void }) {
  const input = useRef<TextInput>(null)
  const [mode, setMode] = useState<'reference' | 'extract'>(capture ? capture.payload.captureMode ?? 'extract' : 'reference')
  const [takeaway, setTakeaway] = useState(capture?.payload.takeaway ?? '')
  const [captureKind, setCaptureKind] = useState<'note' | 'url' | 'file'>(capture?.kind ?? initialCaptureKind)
  const [title, setTitle] = useState(capture?.payload.title ?? '')
  const [text, setText] = useState(capture?.payload.text ?? '')
  const [selection, setSelection] = useState<TextSelection>({ start: 0, end: 0 })
  const [preview, setPreview] = useState(false)
  const [noteImport, setNoteImport] = useState<NoteImportCandidate | null>(null)
  const [saving, setSaving] = useState(false)
  const link = captureKind === 'url' ? safeHttpUrl(text.trim()) : null
  const format = (markdownFormat: MarkdownFormat) => {
    const formatted = applyMarkdownFormat(text, selection, markdownFormat)
    setText(formatted.text)
    setSelection(formatted.selection)
    requestAnimationFrame(() => input.current?.focus())
  }
  const save = () => {
    if (!text.trim()) return
    setSaving(true)
    let payload: IncomingShare
    try {
      payload = normalizeIncomingShare({ text, title, captureMode: captureKind === 'url' ? mode : undefined, takeaway: captureKind === 'url' ? takeaway : undefined, transcription: capture?.kind === 'note' && captureKind === 'note' ? capture.payload.transcription : undefined })
      if (capture?.kind === 'note' && captureKind === 'note') payload = { ...payload, kind: 'note' }
      if (captureKind === 'url' && payload.kind !== 'url') throw new RangeError(t('capture.enter_a_complete_web_address'))
    } catch {
      setSaving(false)
      onNotice(captureKind === 'url' ? t('capture.enter_a_complete_http_or_https_address') : t('capture.enter_a_note'))
      return
    }
    const persist = saveCaptureLocally(payload, capture)
    const target = capture?.destinationMailboxId ? 'desktop' : 'phone'
    void persist.then(async captureId => {
      const linked = capture ? await linkedPhoneNote(captureId) : null
      if (linked) {
        try {
          const connection = await connectCompanion()
          try {
            if (connection.mailboxId === linked.mailboxId) {
              await reconcileDeliveredNotes(connection)
              await syncDesktopEdits(connection)
            }
          } finally {
            connection.close()
          }
        } catch {
          onNotice(t('library.changes_are_encrypted_on_this_phone_and'))
          onQueueChanged()
          onSaved?.()
          return
        }
        onNotice(t('library.changes_are_encrypted_on_this_phone_and'))
      } else if (target === 'desktop') {
        const mailboxId = await currentMailboxId()
        if (mailboxId && mailboxId === capture?.destinationMailboxId) {
          await assignQueuedCapture(captureId, capture.destinationMailboxId)
          const delivered = await deliverQueuedCaptures()
          onNotice(delivered.deliveredOperationIds.includes(captureId) ? t('capture.desktop_accepted_this_source_for_extraction') : t('capture.this_source_is_encrypted_and_waiting_for'))
        } else onNotice(t('capture.this_source_is_encrypted_and_waiting_for'))
      } else if (payload.kind === 'url') {
        const prepared = await prepareCapturedSource(captureId, payload)
        onNotice(prepared ? t('capture.saved_securely_extraction_progress_is_available_in') : captureCopy('saved'))
      } else {
        onNotice(t('capture.saved_encrypted_on_this_phone_send_it'))
      }
      if (!capture) { setText(''); setTitle(''); setTakeaway(''); setMode('reference'); setSelection({ start: 0, end: 0 }); setPreview(false); setCaptureKind(initialCaptureKind) }
      onQueueChanged()
      onSaved?.()
    }).catch(error => onNotice(errorText(error, 'capture.could_not_save_this_capture_securely'))).finally(() => setSaving(false))
  }
  return <View style={styles.panel}>
    {!capture && <View style={styles.captureKinds}>
      <Pressable accessibilityRole="tab" accessibilityState={{ selected: captureKind === 'note' }} onPress={() => setCaptureKind('note')} style={[styles.captureKind, captureKind === 'note' && styles.captureKindSelected]}><Text style={[styles.captureKindText, captureKind === 'note' && styles.captureKindTextSelected]}>{t('common.note')}</Text></Pressable>
      <Pressable accessibilityRole="tab" accessibilityState={{ selected: captureKind === 'url' }} onPress={() => { setCaptureKind('url'); setPreview(false) }} style={[styles.captureKind, captureKind === 'url' && styles.captureKindSelected]}><Text style={[styles.captureKindText, captureKind === 'url' && styles.captureKindTextSelected]}>{t('common.link')}</Text></Pressable>
      <Pressable accessibilityRole="tab" accessibilityState={{ selected: captureKind === 'file' }} onPress={() => { setCaptureKind('file'); setPreview(false) }} style={[styles.captureKind, captureKind === 'file' && styles.captureKindSelected]}><Text style={[styles.captureKindText, captureKind === 'file' && styles.captureKindTextSelected]}>{t('common.upload')}</Text></Pressable>
    </View>}
    {captureKind === 'file' && (noteImport ? <NoteImportPanel candidate={noteImport} cancel={() => setNoteImport(null)} failed={error => onNotice(errorText(error, 'imports.import_failed'))} finished={count => { setNoteImport(null); onNotice(tf('imports.notes_imported', { count })); onQueueChanged(); onSaved?.() }} /> : <FileDropPanel onChoose={file => { if (file.kind === 'text') { setCaptureKind('note'); setTitle(file.title); setText(file.text); setPreview(true) } else if (file.kind === 'pdf') onChoosePdf?.(file.pdf); else if (file.kind === 'image') onChooseImage?.(file.image); else if (file.kind === 'audio') onChooseAudio?.(file.audio); else setNoteImport(file.notes) }} onNotice={onNotice} />)}
    {captureKind !== 'file' && <>
    <Text style={styles.fieldLabel}>{t('common.title')}</Text>
    <TextInput editable={!saving} onChangeText={setTitle} placeholder={t('capture.optional_title')} placeholderTextColor={palette.placeholder} selectionColor={palette.link} style={[styles.input, styles.boxedInput]} value={title} />
    {captureKind === 'note' && <><View style={styles.markdownHeading}><Text style={styles.markdownLabel}>{t('common.formatting')}</Text><Pressable accessibilityRole="button" onPress={() => setPreview(current => !current)}><Text style={styles.markdownPreviewAction}>{preview ? t('common.edit') : t('common.preview')}</Text></Pressable></View><MarkdownToolbar apply={format} /></>}
    {captureKind === 'url' && <Text style={styles.fieldLabel}>{t('common.url_eyebrow')}</Text>}
    {preview && captureKind === 'note' ? <View style={styles.markdownPreview}><MarkdownText text={text || t('capture.nothing_to_preview_yet')} /></View> : <TextInput ref={input} autoCapitalize={captureKind === 'url' ? 'none' : 'sentences'} autoCorrect={captureKind !== 'url'} editable={!saving} keyboardType={captureKind === 'url' ? 'url' : 'default'} multiline={captureKind === 'note'} onChangeText={setText} onSelectionChange={event => setSelection(event.nativeEvent.selection)} placeholder={captureKind === 'url' ? 'https://example.com' : t('capture.write_a_note')} placeholderTextColor={palette.placeholder} selection={captureKind === 'note' ? selection : undefined} selectionColor={palette.link} style={[styles.input, styles.boxedInput, captureKind === 'url' && styles.linkInput, captureKind === 'note' && styles.captureInput, captureKind === 'note' && styles.markdownInput]} textAlignVertical="top" value={text} />}
    {captureKind === 'url' && <LinkCapturePreview host={link?.host ?? null} text={text} />}
    {captureKind === 'url' && <LinkCaptureOptions mode={mode} choose={setMode} takeaway={takeaway} changeTakeaway={setTakeaway} disabled={saving} />}
    {!preview && captureKind === 'note' && text && <View style={styles.markdownLivePreview}><Text style={styles.markdownLivePreviewLabel}>{t('common.formatted_preview')}</Text><MarkdownText text={text} /></View>}
    <Button label={saving ? captureKind === 'url' ? t('common.processing') : t('common.saving') : capture ? t('capture.save_changes') : captureKind === 'url' ? t('capture.add_link') : t('capture.add_note')} onPress={() => save()} busy={saving} disabled={!text.trim() || (captureKind === 'url' && !link)} style={styles.blockButton} />
    </>}

  </View>
}

function FileDropPanel({ onChoose, onNotice }: { readonly onChoose: (file: ChosenFile) => void; readonly onNotice: (notice: string) => void }) {
  const [busy, setBusy] = useState<FileCategory | null>(null)
  const pick = (category: FileCategory) => {
    setBusy(category)
    void chooseFile(category).then(file => { if (file) onChoose(file) }).catch(error => onNotice(errorText(error, 'capture.could_not_read_this_file'))).finally(() => setBusy(null))
  }
  const options: readonly { readonly category: FileCategory; readonly title: string; readonly detail: string }[] = [
    { category: 'audio', title: t('capture.upload_audio'), detail: t('capture.upload_audio_detail') },
    { category: 'video', title: videoRecoveryCopy('upload'), detail: videoRecoveryCopy('uploadDetail') },
    { category: 'pdf', title: t('capture.upload_pdf'), detail: t('capture.upload_pdf_detail') },
    { category: 'image', title: t('capture.upload_images'), detail: t('capture.upload_images_detail') },
    { category: 'text', title: t('capture.upload_markdown'), detail: t('capture.upload_markdown_detail') },
    { category: 'archive', title: t('capture.upload_archives'), detail: t('capture.upload_archives_detail') }
  ]
  return <View style={styles.uploadPanel}>
    <Text style={styles.eyebrow}>{t('capture.upload_eyebrow')}</Text>
    <Text style={styles.panelTitle}>{t('capture.choose_upload_type')}</Text>
    <Text style={styles.capabilityDetail}>{t('capture.upload_description')}</Text>
    <View>{options.map(option => <View key={option.category} style={styles.uploadOption}><View style={styles.libraryCardCopy}><Text style={styles.capabilityName}>{option.title}</Text><Text style={styles.capabilityDetail}>{option.detail}</Text></View><Button label={option.category === 'video' ? videoRecoveryCopy('choose') : t('capture.choose')} onPress={() => pick(option.category)} busy={busy === option.category} disabled={busy !== null} variant="secondary" style={styles.translationPackButton} /></View>)}</View>
  </View>
}
