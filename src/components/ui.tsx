import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, Text, View, type AccessibilityRole, type StyleProp, type ViewStyle } from 'react-native'
import { palette, styles } from '../theme/styles'

export function SettingsCard({ eyebrow, title, description, children }: { readonly eyebrow: string; readonly title: string; readonly description?: string | null; readonly children?: ReactNode }) {
  return <View style={styles.settingsCard}>
    <Text style={styles.eyebrow}>{eyebrow}</Text>
    <Text style={styles.panelTitle}>{title}</Text>
    {description ? <Text style={styles.capabilityDetail}>{description}</Text> : null}
    {children}
  </View>
}

export function Button({ label, onPress, variant = 'primary', disabled = false, busy = false, accessibilityRole = 'button', style }: { readonly label: string; readonly onPress: () => void; readonly variant?: 'primary' | 'secondary' | 'danger'; readonly disabled?: boolean; readonly busy?: boolean; readonly accessibilityRole?: AccessibilityRole; readonly style?: StyleProp<ViewStyle> }) {
  const inactive = disabled || busy
  const container = variant === 'primary' ? styles.buttonPrimary : variant === 'danger' ? styles.buttonDanger : styles.buttonSecondary
  const textStyle = variant === 'secondary' ? styles.buttonSecondaryText : styles.buttonPrimaryText
  return <Pressable accessibilityLabel={label} accessibilityRole={accessibilityRole} accessibilityState={{ disabled: inactive, busy }} disabled={inactive} onPress={onPress} style={({ pressed }) => [styles.buttonBase, container, inactive && styles.buttonDisabled, pressed && styles.buttonPressed, style]}>
    {busy && <ActivityIndicator accessible={false} color={variant === 'secondary' ? palette.link : palette.onPrimary} size="small" />}
    <Text style={[styles.buttonLabel, textStyle]}>{label}</Text>
  </Pressable>
}

export function InAppNotice({ message, dismiss, dismissLabel }: { readonly message: string | null; readonly dismiss: () => void; readonly dismissLabel: string }) {
  if (message === null) return null
  return <View style={styles.noticeModalBackdrop}>
    <View accessibilityLiveRegion="polite" style={styles.noticeModalCard}>
      <Text accessibilityRole="alert" style={styles.noticeModalText}>{message}</Text>
      <IconButton accessibilityLabel={dismissLabel} icon="×" onPress={dismiss} />
    </View>
  </View>
}

export function IconButton({ accessibilityLabel, icon, onPress }: { readonly accessibilityLabel: string; readonly icon: string; readonly onPress: () => void }) {
  return <Pressable accessibilityLabel={accessibilityLabel} accessibilityRole="button" hitSlop={6} onPress={onPress} style={styles.iconButton}>
    <Text accessible={false} style={styles.iconButtonText}>{icon}</Text>
  </Pressable>
}

export function ButtonRow({ children }: { readonly children: ReactNode }) {
  return <View style={styles.buttonRow}>{children}</View>
}
