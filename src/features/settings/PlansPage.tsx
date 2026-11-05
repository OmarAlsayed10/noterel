import { Modal, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { IconButton } from '../../components/ui'
import { t } from '../../i18n'
import { styles } from '../../theme/styles'

const freeFeatures = [
  'plans.free_private_notes',
  'plans.free_imports',
  'plans.free_search',
  'plans.free_whisper',
  'plans.free_desktop',
  'plans.free_backup'
] as const

const plusFeatures = [
  'plans.plus_ask',
  'plans.plus_summaries',
  'plans.plus_ai_allowance',
  'plans.plus_sync',
  'plans.plus_cloud_transcription'
] as const

function FeatureList({ features }: { readonly features: readonly (typeof freeFeatures[number] | typeof plusFeatures[number])[] }) {
  return <View style={styles.planFeatures}>{features.map(feature => <View key={feature} style={styles.planFeature}><Text accessible={false} style={styles.planFeatureMark}>✓</Text><Text style={styles.planFeatureText}>{t(feature)}</Text></View>)}</View>
}

function PlanPrice({ label, price, localPrice }: { readonly label: string; readonly price: string; readonly localPrice: string }) {
  return <View style={styles.planPriceOption}><Text style={styles.planPriceLabel}>{label}</Text><Text style={styles.planPriceValue}>{price}</Text><Text style={styles.planLocalPrice}>{localPrice}</Text></View>
}

function UsageAddOn({ detail, name, price }: { readonly detail: string; readonly name: string; readonly price: string }) {
  return <View style={styles.planAddOn}><View style={styles.libraryCardCopy}><Text style={styles.planAddOnName}>{name}</Text><Text style={styles.planAddOnDetail}>{detail}</Text></View><Text style={styles.planAddOnPrice}>{price}</Text></View>
}

export function PlansPage({ close, visible }: { readonly close: () => void; readonly visible: boolean }) {
  return <Modal animationType="fade" navigationBarTranslucent onRequestClose={close} statusBarTranslucent visible={visible}>
    <SafeAreaView style={styles.plansScreen}>
      <View style={styles.plansHeader}><View style={styles.libraryCardCopy}><Text style={styles.eyebrow}>{t('plans.eyebrow')}</Text><Text style={styles.plansTitle}>{t('plans.page_title')}</Text></View><IconButton accessibilityLabel={t('common.close')} icon="×" onPress={close} /></View>
      <ScrollView contentContainerStyle={styles.plansContent}>
        <Text style={styles.plansIntroduction}>{t('plans.introduction')}</Text>
        <View style={styles.planCard}>
          <View style={styles.planHeading}><View><Text style={styles.planName}>{t('plans.free_name')}</Text><Text style={styles.planPrice}>{t('plans.free_price')}</Text></View><Text style={styles.currentPlanBadge}>{t('plans.current')}</Text></View>
          <Text style={styles.planDescription}>{t('plans.free_description')}</Text>
          <FeatureList features={freeFeatures} />
        </View>
        <View style={[styles.planCard, styles.plusPlanCard]}>
          <View style={styles.planHeading}><Text style={styles.planName}>{t('plans.plus_name')}</Text><View style={styles.plusPlanOrbit}><Text style={styles.plusPlanBadge}>{t('plans.coming_soon')}</Text></View></View>
          <View style={styles.planPrices}><PlanPrice label={t('plans.monthly')} price={t('plans.monthly_usd')} localPrice={t('plans.monthly_egp')} /><PlanPrice label={t('plans.yearly')} price={t('plans.yearly_usd')} localPrice={t('plans.yearly_egp')} /></View>
          <Text style={styles.planPricingNote}>{t('plans.pricing_note')}</Text>
          <Text style={styles.planDescription}>{t('plans.plus_description')}</Text>
          <FeatureList features={plusFeatures} />
        </View>
        <View style={styles.planCard}>
          <Text style={styles.planName}>{t('plans.extra_usage')}</Text>
          <Text style={styles.planDescription}>{t('plans.extra_usage_description')}</Text>
          <View style={styles.planAddOns}><UsageAddOn name={t('plans.extra_audio_name')} detail={t('plans.extra_audio_detail')} price={t('plans.extra_audio_price')} /><UsageAddOn name={t('plans.extra_ai_name')} detail={t('plans.extra_ai_detail')} price={t('plans.extra_ai_price')} /><Text style={styles.planPricingNote}>{t('plans.extra_usage_note')}</Text></View>
          <Text accessibilityLiveRegion="polite" style={[styles.staleNotice, styles.planSubscriptionStatus]}>{t('plans.purchases_not_open')}</Text>
        </View>
        <Text style={styles.plansPrivacy}>{t('plans.privacy')}</Text>
      </ScrollView>
    </SafeAreaView>
  </Modal>
}
