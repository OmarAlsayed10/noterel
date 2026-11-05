import { LinkCaptureOptions } from './LinkCaptureOptions'
import { TikTokCaptionPreview } from './TikTokCaptionPreview'
import { videoRecoveryCopy } from './videoRecoveryCopy'
import { Button } from '../../components/ui'
import { safeHttpUrl } from '../../links'
import { useEffect, useState } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { normalizeIncomingShare, type IncomingShare } from '../../capture/incomingShare'
import { previewTikTokCaptions, tiktokUrl } from '../../sources/tiktok'
import { palette, styles } from '../../theme/styles'
import { t, errorText } from '../../i18n'

export function QuickCapturePanel({ share, save, cancel, state }: { readonly share: IncomingShare | null; readonly save: (capture: IncomingShare) => void; readonly cancel: () => void; readonly state: 'review' | 'saving' | 'failed' }) {
  const [mode, setMode] = useState<'reference' | 'extract'>(share?.captureMode ?? 'reference')
  const [title, setTitle] = useState(share?.title ?? '')
  const [takeaway, setTakeaway] = useState(share?.takeaway ?? '')
  const [text, setText] = useState(share?.text ?? '')
  const [error, setError] = useState<string | null>(null)
  const [loadingCaptions, setLoadingCaptions] = useState(share?.captureMode === 'extract' && tiktokUrl(share?.text ?? ''))
  const [captionPreview, setCaptionPreview] = useState<{ readonly url: string; readonly languages: readonly string[]; readonly selected: string | null } | null>(null)
  const [captionMessage, setCaptionMessage] = useState<string | null>(null)
  useEffect(() => {
    const url = text.trim()
    if (mode !== 'extract' || !tiktokUrl(url)) return
    let active = true
    void previewTikTokCaptions(url).then(video => {
      if (!active) return
      setCaptionPreview({ url, languages: video.captionLanguages, selected: video.captionLanguage })
      if (video.captionLanguages.length === 0) setCaptionMessage(t('capture.tiktok_no_captions'))
    }).catch(error => { if (active) setCaptionMessage(errorText(error, 'capture.tiktok_caption_preview_failed')) }).finally(() => { if (active) setLoadingCaptions(false) })
    return () => { active = false }
  }, [text, mode])
  const chosenCaptions = captionPreview?.url === text.trim() ? captionPreview : null
  const canSave = text.trim() && (mode === 'reference' || !tiktokUrl(text.trim()) || !loadingCaptions && chosenCaptions !== null && (!chosenCaptions.languages.length || chosenCaptions.selected !== null))
  const confirm = (captureMode: 'reference' | 'extract') => {
    try {
      save(normalizeIncomingShare({ text, title, captureMode, takeaway, captionLanguage: captureMode === 'extract' ? chosenCaptions?.selected ?? undefined : undefined }))
    } catch {
      setError(t('capture.enter_text_or_a_complete_http_or'))
    }
  }
  return <View style={styles.quickCaptureCard}>
    <Text style={styles.eyebrow}>{t('capture.add_to_kestrel_eyebrow')}</Text>
    <Text style={styles.quickCaptureTitle}>{t('capture.quick_capture')}</Text>
    {mode === 'extract' && tiktokUrl(text.trim()) && <TikTokCaptionPreview loading={loadingCaptions} captions={chosenCaptions} message={captionMessage} choose={setCaptionPreview} />}
    <TextInput autoFocus multiline onChangeText={value => { setText(value); setError(null); setCaptionPreview(null); setCaptionMessage(null); setLoadingCaptions(mode === 'extract' && tiktokUrl(value.trim())) }} placeholder={t('capture.paste_or_write_something_to_remember')} placeholderTextColor={palette.border} style={styles.quickCaptureInput} textAlignVertical="top" value={text} />
    <TextInput accessibilityLabel={t('common.title')} editable={state !== 'saving'} placeholder={t('capture.optional_title')} value={title} onChangeText={setTitle} style={[styles.input, styles.boxedInput]} />
    {safeHttpUrl(text.trim()) && <LinkCaptureOptions mode={mode} choose={chosen => { setMode(chosen); setLoadingCaptions(chosen === 'extract' && tiktokUrl(text.trim())) }} takeaway={takeaway} changeTakeaway={setTakeaway} disabled={state === 'saving'} />}
    {mode === 'extract' && tiktokUrl(text.trim()) && (!canSave || chosenCaptions?.languages.length === 0) && <Button label={videoRecoveryCopy('saveReference')} onPress={() => confirm('reference')} variant="secondary" disabled={state === 'saving'} />}
    {(error || state === 'failed') && <Text style={styles.quickCaptureError}>{error ?? t('capture.could_not_save_this_capture_securely')}</Text>}
    <View style={styles.quickCaptureActions}>
      <Pressable accessibilityRole="button" disabled={state === 'saving'} onPress={cancel} style={styles.quickCaptureCancel}><Text style={styles.quickCaptureCancelText}>{t('common.cancel')}</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={state === 'saving' || !canSave} onPress={() => confirm(mode)} style={[styles.quickCaptureSave, !canSave && styles.buttonDisabled]}><Text style={styles.quickCaptureSaveText}>{state === 'saving' ? t('common.saving') : t('common.save')}</Text></Pressable>
    </View>
  </View>
}
