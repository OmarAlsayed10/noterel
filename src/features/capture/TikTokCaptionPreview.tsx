import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { t } from '../../i18n'
import { palette, styles } from '../../theme/styles'

interface CaptionPreview { readonly url: string; readonly languages: readonly string[]; readonly selected: string | null }

export function TikTokCaptionPreview({ loading, captions, message, choose }: { readonly loading: boolean; readonly captions: CaptionPreview | null; readonly message: string | null; readonly choose: (captions: CaptionPreview) => void }) {
  return <View>
      <Text style={styles.fieldLabel}>{t('capture.tiktok_caption_language')}</Text>
      {loading ? <View style={styles.channelStatus}><ActivityIndicator color={palette.accent} /><Text style={styles.capabilityDetail}>{t('capture.tiktok_loading_captions')}</Text></View> : captions?.languages.length ? <View style={[styles.captureKinds, styles.captionChoices]}>{captions.languages.map(language => <Pressable accessibilityRole="button" accessibilityState={{ selected: captions.selected === language }} key={language} onPress={() => choose({ ...captions, selected: language })} style={[styles.captureKind, styles.captionChoice, captions.selected === language && styles.captureKindSelected]}><Text style={[styles.captureKindText, captions.selected === language && styles.captureKindTextSelected]}>{language.startsWith('ar') ? t('settings.arabic') : language.startsWith('en') ? t('settings.english') : language}</Text><Text style={[styles.captureKindText, captions.selected === language && styles.captureKindTextSelected]}>{language}</Text></Pressable>)}</View> : null}
      {message && <Text style={styles.quickCaptureError}>{message}</Text>}
      {captions?.languages.length && !captions.selected ? <Text style={styles.capabilityDetail}>{t('capture.tiktok_choose_caption')}</Text> : null}
  </View>
}
