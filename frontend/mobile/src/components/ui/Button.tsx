import React from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type PressableProps, type ViewStyle } from 'react-native'
import { Colors } from '@/constants/colors'

/**
 * DROIN buttons. React Native primitives so the press state is exact (Tamagui 3 dropped the v2
 * pressStyle prop). 14 px radius per DESIGN.md (buttons 12–16, no pills); a 3 px "paper" ledge
 * under filled buttons that flattens when pressed.
 */
type Variant = 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

const HEIGHT: Record<Size, number> = { sm: 40, md: 50, lg: 56 }
const FONT: Record<Size, number> = { sm: 14, md: 16, lg: 17 }

const LOOK: Record<Variant, { bg: string; pressed: string; ledge?: string; text: string; border?: string }> = {
  primary: { bg: Colors.orange, pressed: '#DD9440', ledge: '#C9853A', text: Colors.white },
  secondary: { bg: Colors.white, pressed: Colors.cream, text: Colors.charcoal, border: Colors.borderLight },
  soft: { bg: Colors.softPeach, pressed: '#F6C79E', text: '#8A4E1E' },
  ghost: { bg: 'transparent', pressed: 'rgba(36,35,33,0.05)', text: Colors.charcoal },
  danger: { bg: Colors.expense, pressed: '#B95E40', ledge: '#A85436', text: Colors.white },
}

export interface DroinButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label?: string
  emoji?: string
  variant?: Variant
  size?: Size
  full?: boolean
  loading?: boolean
  style?: ViewStyle
  children?: React.ReactNode
}

export function Button({
  label,
  emoji,
  variant = 'primary',
  size = 'md',
  full,
  loading,
  disabled,
  style,
  children,
  ...props
}: DroinButtonProps) {
  const look = LOOK[variant]
  const inactive = disabled || loading

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      style={({ pressed }) => [
        styles.base,
        {
          height: HEIGHT[size],
          paddingHorizontal: size === 'sm' ? 14 : 20,
          backgroundColor: pressed ? look.pressed : look.bg,
          borderColor: look.border ?? 'transparent',
          borderWidth: look.border ? 1.5 : 0,
        },
        look.ledge && !inactive
          ? { borderBottomWidth: 3, borderBottomColor: pressed ? look.pressed : look.ledge, transform: [{ translateY: pressed ? 2 : 0 }] }
          : null,
        full && styles.full,
        // Disabled stays readable: lighter fill instead of fading the whole button.
        disabled && !loading && (look.ledge ? { backgroundColor: '#F4E1C8' } : { opacity: 0.45 }),
        style,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={look.text} />
      ) : (
        <View style={styles.row}>
          {emoji ? <Text style={{ fontSize: FONT[size] }}>{emoji}</Text> : null}
          {label ? (
            <Text
              numberOfLines={1}
              style={[styles.label, { fontSize: FONT[size], color: disabled && look.ledge ? '#A7774A' : look.text }]}
            >
              {label}
            </Text>
          ) : (
            children
          )}
        </View>
      )}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: { borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  full: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontWeight: '700', letterSpacing: 0.1 },
})
