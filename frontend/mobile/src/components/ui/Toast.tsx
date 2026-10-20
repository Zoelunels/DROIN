import React, { useEffect, useRef, useState } from 'react'
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors } from '@/constants/colors'
import { dismissToast, subscribeToasts, type NotifyTone, type ToastItem } from '@/lib/toast'

const DURATION_MS = 2800
const TONE_BG: Record<NotifyTone, string> = {
  brand: Colors.charcoal,
  success: Colors.income,
  error: Colors.expense,
}

/** One toast: dark rounded card with a big emoji; slides in from the top, tap to close. */
function Toast({ item }: { item: ToastItem }) {
  const enter = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start()
    const timer = setTimeout(() => {
      Animated.timing(enter, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => dismissToast(item.id))
    }, DURATION_MS)
    return () => clearTimeout(timer)
  }, [enter, item.id])

  return (
    <Animated.View
      style={{
        opacity: enter,
        transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }],
      }}
    >
      <Pressable
        onPress={() => dismissToast(item.id)}
        accessibilityRole="alert"
        style={[styles.toast, { backgroundColor: TONE_BG[item.tone] }]}
      >
        <View style={styles.emojiWrap}>
          <Text style={styles.emoji}>{item.emoji}</Text>
        </View>
        <View style={styles.texts}>
          <Text style={styles.title}>{item.title}</Text>
          {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
        </View>
      </Pressable>
    </Animated.View>
  )
}

/** Mount once near the root (AppProviders). Shows notify.*() toasts under the status bar. */
export function ToastHost() {
  const insets = useSafeAreaInsets()
  const [items, setItems] = useState<ToastItem[]>([])
  useEffect(() => subscribeToasts(setItems), [])

  if (items.length === 0) return null
  return (
    <View pointerEvents="box-none" style={[styles.host, { top: insets.top + 8 }]}>
      {items.map((item) => (
        <Toast key={item.id} item={item} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 16, right: 16, alignItems: 'center', gap: 8, zIndex: 1000 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    maxWidth: 420,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  emojiWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  emoji: { fontSize: 18 },
  texts: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: '800', color: Colors.white },
  description: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.82)' },
})
