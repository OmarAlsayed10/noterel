import { useRef, useState } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { connectCompanion } from '../../companion/client'
import { MarkdownText } from '../../notes/MarkdownText'
import { desktopNoteEditTooLarge } from '../../notes/desktop'
import { applyMarkdownFormat } from '../../notes/markdown'
import { pendingDesktopEdits, queueDesktopEdit, syncDesktopEdits } from '../../notes/pendingEdits'
import { Button } from '../../components/ui'
import { palette, styles } from '../../theme/styles'
import { MarkdownToolbar } from '../../components/shared'
import type { MarkdownFormat, TextSelection } from '../../notes/markdown'
import { t } from '../../i18n'

export function DesktopNoteEditor({ note, cancel, saved }: { readonly note: { sourceId: string; destinationMailboxId: string | null; title: string; text: string; projectId: string | null; updatedAt: string }; readonly cancel: () => void; readonly saved: (message: string) => void }) {
  const input = useRef<TextInput>(null)
  const [title, setTitle] = useState(note.title)
  const [text, setText] = useState(note.text)
  const [selection, setSelection] = useState<TextSelection>({ start: 0, end: 0 })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const format = (markdownFormat: MarkdownFormat) => {
    const formatted = applyMarkdownFormat(text, selection, markdownFormat)
    setText(formatted.text)
    setSelection(formatted.selection)
    requestAnimationFrame(() => input.current?.focus())
  }
  const save = () => {
    if (!text.trim() || saving) return
    setSaving(true)
    setMessage(null)
    const saveDurably = async () => {
      await queueDesktopEdit({ sourceId: note.sourceId, destinationMailboxId: note.destinationMailboxId, title: title.trim(), text, projectId: note.projectId, expectedUpdatedAt: note.updatedAt })
      if (desktopNoteEditTooLarge({ ...note, title: title.trim(), text })) {
        saved(t('library.desktop_note_too_large'))
        return
      }
      try {
        const connection = await connectCompanion()
        try {
          await syncDesktopEdits(connection)
        } finally {
          connection.close()
        }
      } catch {
        saved(t('library.changes_are_encrypted_on_this_phone_and'))
        return
      }
      const pending = (await pendingDesktopEdits()).find(edit => edit.sourceId === note.sourceId)
      saved(t(pending?.state === 'conflict' ? 'library.this_note_changed_on_desktop_choose_which' : pending ? 'library.changes_are_encrypted_on_this_phone_and' : 'library.desktop_accepted_the_note_changes'))
    }
    void saveDurably().catch(() => setMessage(t('library.the_note_changes_could_not_be_saved'))).finally(() => setSaving(false))
  }
  return <View style={styles.readerScreen}>
    <View style={styles.readerHeader}><Pressable accessibilityRole="button" disabled={saving} onPress={cancel} style={styles.backButton}><Text style={styles.backButtonText}>{t('library.cancel')}</Text></Pressable><Text style={styles.readerTitle}>{t('library.edit_desktop_note')}</Text></View>
    <ScrollView contentContainerStyle={styles.editorPage}>
      <View style={styles.panel}>
        <Text style={styles.fieldLabel}>{t('common.title')}</Text><TextInput editable={!saving} onChangeText={setTitle} selectionColor={palette.link} style={[styles.input, styles.boxedInput]} value={title} />
        <View style={styles.markdownHeading}><Text style={styles.markdownLabel}>{t('common.formatting')}</Text></View><MarkdownToolbar apply={format} />
        <TextInput ref={input} editable={!saving} multiline onChangeText={setText} onSelectionChange={event => setSelection(event.nativeEvent.selection)} selection={selection} selectionColor={palette.link} style={[styles.input, styles.boxedInput, styles.captureInput, styles.markdownInput]} textAlignVertical="top" value={text} />
        {text && <View style={styles.markdownLivePreview}><Text style={styles.markdownLivePreviewLabel}>{t('common.formatted_preview')}</Text><MarkdownText text={text} /></View>}
        {message && <Text style={styles.inlineFailure}>{message}</Text>}
        <Button label={saving ? t('common.updating') : t('library.update_desktop_note')} onPress={save} busy={saving} disabled={!text.trim()} style={styles.blockButton} />
      </View>
    </ScrollView>
  </View>
}
