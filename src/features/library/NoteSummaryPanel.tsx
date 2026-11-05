import { useEffect, useRef, useState } from 'react'
import { Text, View } from 'react-native'
import { codexCredential } from '../../ai/codexAuth'
import { askCodex } from '../../ai/codexClient'
import { summaryNoteTitle, summarySourceText } from '../../ai/noteSummary'
import { enqueueCapture } from '../../capture/outbox'
import { normalizeIncomingShare } from '../../capture/incomingShare'
import { Button, ButtonRow } from '../../components/ui'
import { t, errorText } from '../../i18n'
import { MarkdownText } from '../../notes/MarkdownText'
import { styles } from '../../theme/styles'
import type { ReadingMemory } from './types'

export function NoteSummaryPanel({ reading, openSettings, saved }: { readonly reading: ReadingMemory; readonly openSettings: () => void; readonly saved: () => void }) {
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [summary, setSummary] = useState('')
  const [message, setMessage] = useState(t('summary.ready_to_summarize'))
  const [activity, setActivity] = useState<'summarizing' | 'saving' | null>(null)
  const requestController = useRef<AbortController | null>(null)
  useEffect(() => {
    void codexCredential().then(credential => setSignedIn(credential !== null)).catch(error => setMessage(errorText(error, 'summary.sign_in_status_unavailable')))
    return () => requestController.current?.abort()
  }, [])
  const summarize = () => {
    const controller = new AbortController()
    const source = summarySourceText(reading.text)
    requestController.current = controller
    setActivity('summarizing')
    setSummary('')
    setMessage(source.truncated ? t('summary.summarizing_first_section') : t('summary.summarizing'))
    const sourceId = reading.sourceId ?? reading.localSourceId ?? reading.captureId ?? 'open-note'
    const prompt = source.truncated ? t('summary.prompt_first_section') : t('summary.prompt')
    void askCodex(prompt, [{ sourceId, title: reading.title, text: source.text }], setSummary, controller.signal).then(answer => {
      setSummary(answer)
      setMessage(source.truncated ? t('summary.review_truncated_before_saving') : t('summary.review_before_saving'))
    }).catch(error => {
      if (!controller.signal.aborted) setMessage(errorText(error, 'summary.could_not_summarize'))
      setSummary('')
    }).finally(() => {
      if (requestController.current === controller) {
        requestController.current = null
        setActivity(null)
      }
    })
  }
  const cancel = () => {
    requestController.current?.abort()
    requestController.current = null
    setActivity(null)
    setSummary('')
    setMessage(t('summary.cancelled'))
  }
  const save = () => {
    setActivity('saving')
    const capture = normalizeIncomingShare({ title: summaryNoteTitle(t('summary.title_prefix'), reading.title), text: summary })
    void enqueueCapture(capture).then(() => {
      setMessage(t('summary.saved_as_new_note'))
      saved()
    }).catch(error => setMessage(errorText(error, 'summary.could_not_save'))).finally(() => setActivity(null))
  }
  return <View style={styles.noteSummaryPanel}>
    <Text style={styles.capabilityDetail}>{signedIn === false ? t('summary.sign_in_required') : message}</Text>
    {summary && <View style={styles.noteSummaryText}><MarkdownText text={summary} /></View>}
    {signedIn === false ? <Button label={t('summary.open_settings')} onPress={openSettings} variant="secondary" /> : activity === 'summarizing' ? <Button label={t('common.cancel')} onPress={cancel} variant="secondary" /> : summary ? <ButtonRow><Button label={t('summary.regenerate')} onPress={summarize} disabled={activity === 'saving'} variant="secondary" /><Button label={t('summary.save_as_new_note')} onPress={save} busy={activity === 'saving'} /></ButtonRow> : <Button label={t('summary.summarize_note')} onPress={summarize} disabled={signedIn !== true || !reading.text.trim()} />}
  </View>
}
