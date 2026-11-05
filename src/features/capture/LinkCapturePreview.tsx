import { Text, View } from 'react-native'
import { t } from '../../i18n'
import { styles } from '../../theme/styles'

export function LinkCapturePreview({ host, text }: { readonly host: string | null; readonly text: string }) {
  return <View style={[styles.linkPreview, styles.linkCapturePreview, !host && styles.linkPreviewInvalid]}>
    <Text style={styles.linkPreviewLabel}>{host ? t('capture.ready_to_save') : t('capture.enter_a_complete_http_or_https_address_2')}</Text>
    <Text numberOfLines={1} style={styles.linkPreviewValue}>{host ?? (text.trim() || t('capture.no_url_entered'))}</Text>
  </View>
}
