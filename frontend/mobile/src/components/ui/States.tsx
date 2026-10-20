import React from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { Mascot } from '@/components/Mascot'
import { Button } from '@/components/ui/Button'
import { Colors } from '@/constants/colors'

/** Friendly empty state with the mascot and a bit of dry humour. */
export function EmptyState({
  title = 'Nothing happened here. Suspicious.',
  subtitle = 'Add your first entry and this page will fill up.',
  emoji,
  mood = 'curious',
  actionLabel,
  onAction,
  compact,
}: {
  title?: string
  subtitle?: string
  emoji?: string
  mood?: 'happy' | 'wink' | 'cheer' | 'sleepy' | 'sad' | 'curious'
  actionLabel?: string
  onAction?: () => void
  compact?: boolean
}) {
  return (
    <View style={[styles.center, { paddingVertical: compact ? 16 : 32 }]}>
      <Mascot size={compact ? 90 : 130} mood={mood} animated />
      <View style={styles.texts}>
        <Text style={styles.title}>
          {emoji ? `${emoji} ` : ''}
          {title}
        </Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      {actionLabel && onAction ? <Button label={actionLabel} emoji="➕" onPress={onAction} /> : null}
    </View>
  )
}

/** Centered loading state. */
export function LoadingState({ label = 'Counting the coins…' }: { label?: string }) {
  return (
    <View style={[styles.center, styles.fill]}>
      <ActivityIndicator size="large" color={Colors.orange} />
      <Text style={styles.loading}>{label}</Text>
    </View>
  )
}

/** Error state with a sad mascot and a retry button. */
export function ErrorState({
  message = 'The drawer jammed. Try again?',
  onRetry,
}: {
  message?: string
  onRetry?: () => void
}) {
  return (
    <View style={[styles.center, styles.fill, { paddingHorizontal: 24 }]}>
      <Mascot size={110} mood="sad" animated />
      <Text style={styles.title}>{message}</Text>
      {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} emoji="🔄" /> : null}
    </View>
  )
}

/** A small inline banner used for hints and warnings. */
export function Banner({
  emoji = '💡',
  text,
  tone = 'brand',
}: {
  emoji?: string
  text: string
  tone?: 'brand' | 'income' | 'expense'
}) {
  const look = BANNER[tone]
  return (
    <View style={[styles.banner, { backgroundColor: look.bg, borderColor: look.border }]} accessibilityRole="alert">
      <Text style={styles.bannerEmoji}>{emoji}</Text>
      <Text style={[styles.bannerText, { color: look.color }]}>{text}</Text>
    </View>
  )
}

const BANNER = {
  brand: { bg: '#FDF3E7', border: '#F7E2C8', color: '#8A4E1E' },
  income: { bg: '#EAF0EA', border: '#D5E3D5', color: '#3F5A44' },
  expense: { bg: '#F6E3DC', border: '#F0D2C6', color: '#7C3A25' },
} as const

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 16 },
  texts: { alignItems: 'center', gap: 8, maxWidth: 300 },
  title: { fontSize: 18, fontWeight: '800', color: Colors.charcoal, textAlign: 'center' },
  subtitle: { fontSize: 15, lineHeight: 22, color: Colors.secondaryGray, textAlign: 'center' },
  loading: { fontSize: 15, fontWeight: '600', color: Colors.secondaryGray },
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 14, borderWidth: 1.5 },
  bannerEmoji: { fontSize: 18, lineHeight: 22 },
  bannerText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '600' },
})
