import React from 'react'
import { Platform, ScrollView, StyleSheet, View, useWindowDimensions, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Colors } from '@/constants/colors'

/** Content never gets wider than this, so tablets and landscape phones keep a readable column. */
export const MAX_CONTENT_WIDTH = 480

/**
 * Standard screen shell: safe-area padding on all four edges (notch, home indicator, landscape
 * cut-outs), a 20 px gutter (16 px on very narrow phones), and a centred column capped at 480 px.
 * `centered` vertically centres short content, such as the login form.
 * `inTabs`: the bottom menu already sits above the home indicator, so no bottom inset is added.
 */
export function Screen({
  children,
  scroll = true,
  padded = true,
  centered = false,
  inTabs = false,
  bottomSpace = 24,
  bg = Colors.background,
  contentStyle,
  refreshControl,
}: {
  children: React.ReactNode
  scroll?: boolean
  padded?: boolean
  centered?: boolean
  inTabs?: boolean
  bottomSpace?: number
  bg?: string
  contentStyle?: ViewStyle
  /** Pull-to-refresh control for scrolling screens. */
  refreshControl?: React.ComponentProps<typeof ScrollView>['refreshControl']
}) {
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const gutter = padded ? (width < 360 ? 16 : 20) : 0

  const padding: ViewStyle = {
    paddingTop: insets.top + 12,
    paddingBottom: (inTabs ? 0 : insets.bottom) + bottomSpace,
    paddingLeft: insets.left + gutter,
    paddingRight: insets.right + gutter,
  }
  const column = <View style={[styles.column, centered && styles.centered, contentStyle]}>{children}</View>

  if (!scroll) {
    return <View style={[styles.fill, padding, { backgroundColor: bg }]}>{column}</View>
  }

  return (
    <ScrollView
      style={[styles.fill, { backgroundColor: bg }]}
      contentContainerStyle={[styles.grow, padding]}
      keyboardShouldPersistTaps="handled"
      // Android has no "interactive": it behaves like on-drag, so the slight finger movement of a tap
      // on a field could close the keyboard the moment it opened.
      keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'none'}
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl}
    >
      {column}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  grow: { flexGrow: 1 },
  column: { flexGrow: 1, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', gap: 16 },
  centered: { justifyContent: 'center' },
})
