import React from 'react'
import { ActivityIndicator, Platform, Pressable, Text, View, type PressableProps, type ViewStyle } from 'react-native'
import * as Haptics from 'expo-haptics'
import { Icon, type IconName } from '@/components/ui/Icon'
import { Fonts, makeStyles, useColors, type Palette } from '@/constants/colors'

/**
 * DROIN buttons. Orange with ink text, like the mascot (ink outline on an orange box), which also
 * reads far better than white on orange. Filled buttons sit on a "ledge" (the mascot's shaded
 * side) that presses down with the button, plus a light haptic tap on phones.
 */
type Variant = 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger' | 'ink'
type Size = 'sm' | 'md' | 'lg'

const HEIGHT: Record<Size, number> = { sm: 40, md: 50, lg: 56 }
const FONT: Record<Size, number> = { sm: 14, md: 16, lg: 17 }
const LEDGE = 3

type Look = { bg: string; pressed: string; ledge?: string; text: string; border?: string }

// Orange is the mascot in both themes: ink text on it, the shaded side as its ledge.
const lookFor = (Colors: Palette): Record<Variant, Look> => ({
  primary: { bg: Colors.orange, pressed: '#EC8A2E', ledge: Colors.orangeLedge, text: Colors.onOrange },
  ink: { bg: Colors.inkCard, pressed: '#3A2A20', ledge: Colors.inkLedge, text: Colors.face },
  secondary: { bg: Colors.surface, pressed: Colors.cream, ledge: Colors.borderLight, text: Colors.charcoal, border: Colors.borderLight },
  soft: { bg: Colors.orangeSoft, pressed: Colors.orangeBorder, text: Colors.orangeDeep },
  ghost: { bg: 'transparent', pressed: Colors.cream, text: Colors.charcoal },
  danger: { bg: '#B04F2F', pressed: '#963F22', ledge: '#7A321B', text: Colors.onColor },
})

export const tapHaptic = () => {
  if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
}

export interface DroinButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label?: string
  icon?: IconName
  variant?: Variant
  size?: Size
  full?: boolean
  loading?: boolean
  style?: ViewStyle
  children?: React.ReactNode
}

export function Button({
  label,
  icon,
  variant = 'primary',
  size = 'md',
  full,
  loading,
  disabled,
  style,
  children,
  onPress,
  ...props
}: DroinButtonProps) {
  const Colors = useColors()
  const styles = useStyles()
  const look = lookFor(Colors)[variant]
  const inactive = disabled || loading
  const hasLedge = !!look.ledge && !inactive

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={(e) => {
        if (variant === 'primary' || variant === 'danger' || variant === 'ink') tapHaptic()
        onPress?.(e)
      }}
      style={({ pressed }) => [
        styles.base,
        {
          height: HEIGHT[size],
          paddingHorizontal: size === 'sm' ? 14 : 20,
          backgroundColor: pressed ? look.pressed : look.bg,
          borderColor: look.border ?? 'transparent',
          borderWidth: look.border ? 1.5 : 0,
        },
        // The ledge is a thick bottom edge. Pressing sinks the button onto it: the edge goes and the
        // button moves down by the same amount, so nothing around it shifts.
        hasLedge
          ? pressed
            ? { marginTop: LEDGE }
            : { height: HEIGHT[size] + LEDGE, borderBottomWidth: LEDGE + (look.border ? 1.5 : 0), borderBottomColor: look.ledge }
          : look.ledge
            ? { marginTop: LEDGE } // disabled or busy: sunk in, same footprint as when enabled
            : null,
        full && styles.full,
        // Disabled stays readable: a pale fill instead of fading the whole button.
        disabled && !loading && (look.ledge && !look.border ? { backgroundColor: Colors.disabledBg } : { opacity: 0.45 }),
        style,
      ]}
      {...props}
    >
      {loading ? (
        <ActivityIndicator color={look.text} />
      ) : (
        <View style={styles.row}>
          {icon ? <Icon name={icon} size={FONT[size] + 3} strokeWidth={2.4} color={disabled && look.ledge && !look.border ? Colors.muted : look.text} /> : null}
          {label ? (
            <Text
              numberOfLines={1}
              style={[styles.label, { fontSize: FONT[size], color: disabled && look.ledge && !look.border ? Colors.muted : look.text }]}
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

const useStyles = makeStyles((Colors) => ({
  base: { borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  full: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontFamily: Fonts.extrabold, letterSpacing: 0.1 },
}))
