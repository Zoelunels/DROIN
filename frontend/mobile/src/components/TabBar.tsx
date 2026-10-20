import React, { useEffect, useState } from 'react'
import { Keyboard, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import type { Tabs } from 'expo-router/js-tabs'
import { Colors } from '@/constants/colors'

type TabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0]
type IconName = keyof typeof Ionicons.glyphMap

/** Route name → label and icon (outline when idle, filled when active). "add" is the centre button. */
const TABS: Record<string, { label: string; icon: IconName; iconActive: IconName }> = {
  index: { label: 'Home', icon: 'home-outline', iconActive: 'home' },
  history: { label: 'History', icon: 'receipt-outline', iconActive: 'receipt' },
  add: { label: 'Add', icon: 'add', iconActive: 'add' },
  wallets: { label: 'Wallets', icon: 'wallet-outline', iconActive: 'wallet' },
  me: { label: 'Me', icon: 'person-outline', iconActive: 'person' },
}

const BAR_HEIGHT = 60
const ADD_SIZE = 56

/** Android: true while the keyboard is open, so the tab bar can step aside instead of riding on top of it. */
function useKeyboardOpen() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (Platform.OS !== 'android') return
    const show = Keyboard.addListener('keyboardDidShow', () => setOpen(true))
    const hide = Keyboard.addListener('keyboardDidHide', () => setOpen(false))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  return open
}

/**
 * DROIN bottom menu: four quiet tabs and one orange "+" in the middle (the drawer slot).
 * Sits above the home indicator / Android gesture bar using the safe-area inset.
 */
export function TabBar({ state, navigation, insets }: TabBarProps) {
  const keyboardOpen = useKeyboardOpen()
  if (keyboardOpen) return null

  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom, paddingLeft: insets.left, paddingRight: insets.right }]}>
      {state.routes.map((route, index) => {
        const tab = TABS[route.name]
        if (!tab) return null
        const focused = state.index === index

        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params)
        }

        if (route.name === 'add') {
          return (
            <View key={route.key} style={styles.item}>
              <Pressable
                onPress={onPress}
                accessibilityRole="button"
                accessibilityLabel="Put something in"
                accessibilityState={{ selected: focused }}
                hitSlop={6}
                style={({ pressed }) => [styles.add, pressed && styles.addPressed]}
              >
                <Ionicons name="add" size={30} color={Colors.white} />
              </Pressable>
            </View>
          )
        }

        const color = focused ? Colors.charcoal : Colors.secondaryGray
        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: focused }}
            style={styles.item}
          >
            {({ pressed }) => (
              <View style={[styles.itemInner, pressed && styles.itemPressed]}>
                <Ionicons name={focused ? tab.iconActive : tab.icon} size={22} color={color} />
                <Text style={[styles.label, { color }, focused && styles.labelActive]}>{tab.label}</Text>
                <View style={[styles.dot, { opacity: focused ? 1 : 0 }]} />
              </View>
            )}
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
  },
  item: { flex: 1, height: BAR_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  itemInner: { alignItems: 'center', gap: 2, paddingTop: 4 },
  itemPressed: { opacity: 0.55 },
  label: { fontSize: 11, fontWeight: '600' },
  labelActive: { fontWeight: '700' },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: Colors.orange, marginTop: 1 },
  // Raised out of the bar like a drawer handle; a cream ring separates it from the page behind.
  add: {
    width: ADD_SIZE,
    height: ADD_SIZE,
    borderRadius: 18,
    marginTop: -22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.orange,
    borderWidth: 4,
    borderColor: Colors.background,
  },
  addPressed: { backgroundColor: '#DD9440', transform: [{ scale: 0.96 }] },
})
