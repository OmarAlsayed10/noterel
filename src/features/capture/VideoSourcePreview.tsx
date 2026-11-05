import { Image, Text, View } from 'react-native'
import { Button } from '../../components/ui'
import { t } from '../../i18n'
import { openHttpUrl, safeHttpUrl } from '../../links'
import { safeImageUrl } from '../../sources/webpage'
import { styles } from '../../theme/styles'
import type { VideoSource } from '../../transcription/source'

export function VideoSourcePreview({ source }: { readonly source: VideoSource }) {
  const url = safeHttpUrl(source.url)
  if (!url) return null
  const thumbnail = safeImageUrl(source.thumbnailUrl ?? undefined, source.url)
  return <View style={styles.transcriptSource}>
    {thumbnail && <Image accessibilityLabel={t('transcription.original_video')} resizeMode="contain" source={{ uri: thumbnail }} style={styles.transcriptSourceImage} />}
    <Text numberOfLines={2} style={styles.capabilityName}>{source.title || t('transcription.original_video')}</Text>
    <Button label={t('transcription.open_original_video')} onPress={() => openHttpUrl(source.url)} variant="secondary" />
  </View>
}
