import React, { useEffect, useState } from 'react'
import { ActivityIndicator, Animated, Text, View } from 'react-native'
import { Mascot } from '@/components/Mascot'
import { Button } from '@/components/ui/Button'
import { Icon, type IconName } from '@/components/ui/Icon'
import { Fonts, makeStyles, useColors, type Palette } from '@/constants/colors'

/** Friendly empty state with the mascot and a bit of dry humour. */
export function EmptyState({
  title = 'Nothing happened here. Suspicious.',
  subtitle = 'Add your first entry and this page will fill up.',
  mood = 'curious',
  actionLabel,
  onAction,
  compact,
}: {
  title?: string
  subtitle?: string
  mood?: 'happy' | 'wink' | 'cheer' | 'sleepy' | 'sad' | 'curious'
  actionLabel?: string
  onAction?: () => void
  compact?: boolean
}) {
  const styles = useStyles()
  return (
    <View style={[styles.center, { paddingVertical: compact ? 16 : 32 }]}>
      <Mascot size={compact ? 90 : 130} mood={mood} animated />
      <View style={styles.texts}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} /> : null}
    </View>
  )
}

/** A soft pulsing placeholder block, shown where content will load (instead of "–"). */
export function Skeleton({ width, height = 14, radius = 8, dark }: { width: number | `${number}%`; height?: number; radius?: number; dark?: boolean }) {
  const Colors = useColors()
  const [pulse] = useState(() => new Animated.Value(0.5))
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [pulse])
  return (
    <Animated.View
      style={{ width, height, borderRadius: radius, opacity: pulse, backgroundColor: dark ? 'rgba(248,232,204,0.16)' : Colors.cream }}
    />
  )
}

/** Centered loading state. */
export function LoadingState({ label = 'Counting the coins…' }: { label?: string }) {
  const Colors = useColors()
  const styles = useStyles()
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
  const styles = useStyles()
  return (
    <View style={[styles.center, styles.fill, { paddingHorizontal: 24 }]}>
      <Mascot size={110} mood="sad" animated />
      <Text style={styles.title}>{message}</Text>
      {onRetry ? <Button label="Try again" variant="secondary" onPress={onRetry} icon="refresh" /> : null}
    </View>
  )
}

/** A small inline banner used for hints and warnings. */
export function Banner({
  icon = 'lightbulb',
  text,
  tone = 'brand',
}: {
  icon?: IconName
  text: string
  tone?: 'brand' | 'income' | 'expense'
}) {
  const styles = useStyles()
  const Colors = useColors()
  const look = bannerLook(Colors)[tone]
  return (
    <View style={[styles.banner, { backgroundColor: look.bg, borderColor: look.border }]} accessibilityRole="alert">
      <Icon name={icon} size={19} color={look.color} strokeWidth={2.25} style={styles.bannerIcon} />
      <Text style={[styles.bannerText, { color: look.color }]}>{text}</Text>
    </View>
  )
}

const bannerLook = (Colors: Palette) => ({
  brand: { bg: Colors.orangeSoft, border: Colors.orangeBorder, color: Colors.orangeDeep },
  income: { bg: Colors.incomeSoft, border: Colors.incomeBorder, color: Colors.income },
  expense: { bg: Colors.expenseSoft, border: Colors.expenseBorder, color: Colors.expense },
})

const useStyles = makeStyles((Colors) => ({
  fill: { flex: 1, backgroundColor: Colors.background },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 16 },
  texts: { alignItems: 'center', gap: 8, maxWidth: 300 },
  title: { fontSize: 18, fontFamily: Fonts.extrabold, color: Colors.charcoal, textAlign: 'center' },
  subtitle: { fontFamily: Fonts.regular, fontSize: 15, lineHeight: 22, color: Colors.secondaryGray, textAlign: 'center' },
  loading: { fontSize: 15, fontFamily: Fonts.semibold, color: Colors.secondaryGray },
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 14, borderWidth: 1.5 },
  bannerIcon: { marginTop: 1 },
  bannerText: { flex: 1, fontSize: 14, lineHeight: 20, fontFamily: Fonts.semibold },
}))
