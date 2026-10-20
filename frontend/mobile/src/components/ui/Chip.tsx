import React from 'react'
import { Pressable, StyleSheet, Text } from 'react-native'
import { Colors } from '@/constants/colors'

/** Selectable chip for filters and pickers: 34 px tall, 10 px radius, charcoal when picked. */
export function Chip({
  label,
  emoji,
  active,
  onPress,
}: {
  label: string
  emoji?: string | null
  active?: boolean
  onPress?: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: active ? Colors.charcoal : pressed ? Colors.cream : Colors.white },
        { borderColor: active ? Colors.charcoal : Colors.borderLight },
      ]}
    >
      {emoji ? <Text style={styles.emoji}>{emoji}</Text> : null}
      <Text style={[styles.label, { color: active ? Colors.white : Colors.charcoal }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1.5,
  },
  emoji: { fontSize: 14 },
  label: { fontSize: 14, fontWeight: '600' },
})
