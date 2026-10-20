import React, { forwardRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Colors } from '@/constants/colors'

/**
 * DROIN text field. Built on React Native primitives so sizing, focus and error states are exact
 * (Tamagui 3 no longer supports the v2 focusStyle/pressStyle props).
 *
 * 52 px tall, 14 px radius (DESIGN.md: inputs 12–14), white fill on the cream page, orange border
 * while focused. Password fields get a show/hide toggle automatically.
 */
export interface InputFieldProps extends TextInputProps {
  label?: string
  icon?: keyof typeof Ionicons.glyphMap
  error?: string
  hint?: string
}

export const Input = forwardRef<TextInput, InputFieldProps>(function Input(
  { label, icon, error, hint, secureTextEntry, style, onFocus, onBlur, editable = true, ...props },
  ref,
) {
  const [focused, setFocused] = useState(false)
  const [hidden, setHidden] = useState(true)
  const isPassword = secureTextEntry === true

  return (
    <View style={styles.wrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}

      {/* Same style keys in every state, only the values change. On Android's new architecture,
          adding or removing style props (e.g. a shadow) on focus can rebuild the native view around
          the text field, which drops focus and closes the keyboard after every tap. */}
      <View
        style={[
          styles.field,
          {
            borderColor: error ? Colors.expense : focused ? Colors.orange : Colors.borderLight,
            backgroundColor: error ? '#FDF6F3' : editable ? Colors.white : Colors.cream,
          },
        ]}
      >
        {icon ? (
          <Ionicons
            name={icon}
            size={18}
            color={error ? Colors.expense : focused ? Colors.orange : Colors.secondaryGray}
            style={styles.icon}
          />
        ) : null}
        <TextInput
          ref={ref}
          style={[styles.input, style]}
          placeholderTextColor="#ABA59C"
          selectionColor={Colors.orange}
          cursorColor={Colors.orange}
          secureTextEntry={isPassword && hidden}
          editable={editable}
          onFocus={(e) => {
            setFocused(true)
            onFocus?.(e)
          }}
          onBlur={(e) => {
            setFocused(false)
            onBlur?.(e)
          }}
          {...props}
        />
        {isPassword ? (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            style={styles.trailing}
          >
            <Ionicons name={hidden ? 'eye-outline' : 'eye-off-outline'} size={19} color={Colors.secondaryGray} />
          </Pressable>
        ) : null}
      </View>

      {error ? (
        <View style={styles.messageRow}>
          <Ionicons name="alert-circle" size={14} color={Colors.expense} />
          <Text style={[styles.message, styles.error]}>{error}</Text>
        </View>
      ) : hint ? (
        <Text style={[styles.message, styles.hint]}>{hint}</Text>
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  wrap: { width: '100%', gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.charcoal, letterSpacing: 0.1 },
  field: {
    width: '100%',
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.white,
    paddingHorizontal: 14,
  },
  icon: { marginRight: 10 },
  // 16 px keeps iOS Safari from zooming on focus. Android adds its own font padding and top-aligns
  // text in a fixed-height field, so both are turned off to keep the text centred and unclipped.
  input: {
    flex: 1,
    height: '100%',
    fontSize: 16,
    fontWeight: '500',
    color: Colors.charcoal,
    paddingVertical: 0,
    paddingHorizontal: 0,
    includeFontPadding: false,
    textAlignVertical: 'center',
    // Web only: hide the browser focus outline (the border shows focus). Native has no "none" value.
    ...Platform.select({ web: { outlineStyle: 'none' }, default: {} }),
  } as object,
  trailing: { marginLeft: 8, height: '100%', justifyContent: 'center' },
  messageRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 2 },
  message: { fontSize: 13, lineHeight: 18 },
  error: { color: Colors.expense, fontWeight: '600', flex: 1 },
  hint: { color: Colors.secondaryGray, paddingLeft: 2 },
})
