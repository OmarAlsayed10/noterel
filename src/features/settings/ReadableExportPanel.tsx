import { useState } from 'react'
import { TextInput } from 'react-native'
import { shareReadableNotebook } from '../../backup/readableExport'
import { Button, SettingsCard } from '../../components/ui'
import { currentLanguage, tm } from '../../i18n'
import { palette, styles } from '../../theme/styles'

export function ReadableExportPanel() {
  const arabic = currentLanguage() === 'ar'
  const [collection, setCollection] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const share = () => {
    setBusy(true)
    void shareReadableNotebook(collection).then(count => setMessage(arabic ? `تم تصدير ${count} ملاحظة.` : `Exported ${count} notes.`))
      .catch(error => setMessage(error instanceof Error ? tm(error.message) : arabic ? 'تعذّر تصدير الملاحظات.' : 'Notes could not be exported.'))
      .finally(() => setBusy(false))
  }
  return <SettingsCard eyebrow={arabic ? 'نسخة قابلة للقراءة' : 'Readable copy'} title={arabic ? 'تصدير ملاحظاتك' : 'Export your notes'} description={message ?? (arabic ? 'نصوص وروابط وملاحظاتك الشخصية في ملف Markdown غير مشفّر. ملفات الصور وPDF الأصلية غير مضمّنة.' : 'Readable text, source links, and personal notes in an unencrypted Markdown file. Original images and PDFs are not included.')}>
    <TextInput accessibilityLabel={arabic ? 'المجموعة الاختيارية' : 'Optional collection'} editable={!busy} maxLength={64} onChangeText={setCollection} placeholder={arabic ? 'اسم المجموعة، أو اتركه فارغًا لتصدير الكل' : 'Collection name, or leave empty for all notes'} placeholderTextColor={palette.placeholder} style={[styles.input, styles.boxedInput]} value={collection} />
    <Button label={arabic ? 'مشاركة ملف Markdown' : 'Share Markdown file'} onPress={share} busy={busy} />
  </SettingsCard>
}
