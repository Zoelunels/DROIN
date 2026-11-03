import React, { useEffect, useState } from 'react'
import { Image, Keyboard, Platform, Pressable, Text, View, type LayoutChangeEvent } from 'react-native'
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  Easing,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Path } from 'react-native-svg'
import * as Haptics from 'expo-haptics'
import type { Tabs } from 'expo-router/js-tabs'
import { Coin } from '@/components/Mascot'
import { Icon, type IconName } from '@/components/ui/Icon'
import { Fonts, makeStyles, useColors, useTheme } from '@/constants/colors'

type TabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0]

/** Route name → label and icon, in the order they sit on the bar. 'add' is the raised centre button. */
const TABS: Record<string, { label: string; icon: IconName }> = {
  index: { label: 'Home', icon: 'home' },
  history: { label: 'History', icon: 'receipt' },
  add: { label: 'Add', icon: 'add' },
  wallets: { label: 'Wallets', icon: 'wallet' },
  me: { label: 'Me', icon: 'user' },
}
const ORDER = Object.keys(TABS)

const BAR_HEIGHT = 64
/** How much of the screen bottom the bar covers (plus the safe area): tab screens leave this much room. */
export const TAB_BAR_HEIGHT = BAR_HEIGHT
const SIDE_PAD = 10 // slots start a little in from the bar's rounded ends
const BUBBLE = 50 // the orange circle that carries the selected icon
const NOTCH_DEPTH = 26
// A calm glide: eases out, no overshoot.
const SLIDE = { duration: 320, easing: Easing.out(Easing.cubic) }

/**
 * The bar's outline with a smooth dip ("notch") centred at x, as an SVG path. Runs on the UI thread
 * (a worklet) so the dip slides with the spring at 60 fps. The top corners shrink when the dip
 * reaches an end, so the curve never folds back over the rounded corner.
 */
function barPath(x: number, width: number, height: number): string {
  'worklet'
  const half = 36 // half the dip's opening at the top
  const shoulder = 9 // the gentle round-off where the dip meets the flat top
  const left = x - half - shoulder
  const right = x + half + shoulder
  const rl = Math.max(0, Math.min(22, left))
  const rr = Math.max(0, Math.min(22, width - right))
  return [
    `M0 ${rl}`,
    `Q0 0 ${rl} 0`,
    `L${left} 0`,
    `C${left + shoulder + 6} 0 ${x - 24} ${NOTCH_DEPTH} ${x} ${NOTCH_DEPTH}`,
    `C${x + 24} ${NOTCH_DEPTH} ${right - shoulder - 6} 0 ${right} 0`,
    `L${width - rr} 0`,
    `Q${width} 0 ${width} ${rr}`,
    `L${width} ${height}`,
    `L0 ${height}`,
    'Z',
  ].join(' ')
}

const AnimatedPath = Animated.createAnimatedComponent(Path)

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
 * DROIN bottom menu: a floating ink bar with a dip that slides to the selected tab, where its icon
 * rides up in an orange circle. The orange "+" stays raised in the middle (the drawer slot); when Add
 * is open the dip sits under it.
 */
export function TabBar({ state, emitter, navigateToTab, insets }: TabBarProps) {
  const Colors = useColors()
  const { scheme } = useTheme()
  const styles = useStyles()
  const keyboardOpen = useKeyboardOpen()
  const [width, setWidth] = useState(0)

  // On a screen without its own tab (an entry's details), keep the tab it was opened from lit.
  const current = state.routes[state.index]
  const from = (current?.params as { from?: string } | undefined)?.from
  const lit = current && TABS[current.name] ? current.name : from && TABS[from] ? from : 'history'
  const litIndex = Math.max(0, ORDER.indexOf(lit))
  const inner = width - SIDE_PAD * 2 - insets.left - insets.right
  const slot = width > 0 ? inner / ORDER.length : 0
  const target = SIDE_PAD + insets.left + slot * (litIndex + 0.5)
  const onAdd = lit === 'add'

  const x = useSharedValue(target)
  const barWidth = useSharedValue(width)
  const pop = useSharedValue(1)
  const shown = useSharedValue(onAdd ? 0 : 1)

  useEffect(() => {
    if (width === 0) return
    if (barWidth.value === 0) x.value = target // first layout: start in place, no slide from 0
    else x.value = withTiming(target, SLIDE)
    barWidth.value = width
  }, [target, width, x, barWidth])

  useEffect(() => {
    shown.value = withTiming(onAdd ? 0 : 1, { duration: 160 })
    // A small settle as the circle arrives, no wobble.
    pop.value = withSequence(withTiming(0.92, { duration: 120 }), withTiming(1, { duration: 200, easing: Easing.out(Easing.quad) }))
  }, [litIndex, onAdd, shown, pop])

  const fullHeight = BAR_HEIGHT + insets.bottom
  const pathProps = useAnimatedProps(() => ({ d: barPath(x.value, Math.max(barWidth.value, 1), fullHeight) }))
  const bubbleStyle = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateX: x.value - BUBBLE / 2 }, { scale: pop.value * (0.6 + 0.4 * shown.value) }],
  }))

  if (keyboardOpen) return null

  const barFill = scheme === 'dark' ? '#2A1F18' : Colors.inkCard
  const litIcon = TABS[lit]?.icon ?? 'home'

  return (
    // Floats over the screen: the strip above the bar is see-through and lets touches through, so pages
    // scroll behind the circle and the "+" instead of being cut off by a band of page colour.
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={{ height: fullHeight }} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
        {width > 0 ? (
          <Svg width={width} height={fullHeight} style={styles.shape} pointerEvents="none">
            <AnimatedPath animatedProps={pathProps} fill={barFill} stroke={scheme === 'dark' ? Colors.borderLight : 'none'} strokeWidth={1.5} />
          </Svg>
        ) : null}

        {/* The selected icon, riding in an orange circle that floats in the dip. */}
        <Animated.View pointerEvents="none" style={[styles.bubble, bubbleStyle]}>
          <Icon name={litIcon} size={22} strokeWidth={2.5} color={Colors.ink} />
        </Animated.View>

        <View style={[styles.row, { paddingLeft: SIDE_PAD + insets.left, paddingRight: SIDE_PAD + insets.right }]}>
          {ORDER.map((name) => {
            const route = state.routes.find((r) => r.name === name)
            if (!route) return <View key={name} style={styles.item} />
            const index = state.routes.indexOf(route)
            const tab = TABS[name]!
            const showing = state.index === index // this screen is on screen right now
            const focused = name === lit // this tab is highlighted

            const onPress = () => {
              const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
              if (!showing && !event.defaultPrevented) {
                if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {})
                navigateToTab(route.key)
              }
            }

            if (name === 'add') {
              return (
                <View key={route.key} style={styles.item}>
                  <AddCoin open={focused} onPress={onPress} />
                </View>
              )
            }

            return (
              <Pressable
                key={route.key}
                onPress={onPress}
                accessibilityRole="tab"
                accessibilityLabel={tab.label}
                accessibilityState={{ selected: focused }}
                style={styles.item}
              >
                {(pressState) => {
                  const touched = pressState.pressed || (pressState as { hovered?: boolean }).hovered
                  return (
                    <View style={styles.itemInner}>
                      {/* The selected tab's icon travels in the orange circle; its slot keeps the space. */}
                      <View style={{ opacity: focused ? 0 : 1, transform: [{ scale: pressState.pressed ? 0.9 : 1 }] }}>
                        <Icon name={tab.icon} size={21} color={touched ? Colors.face : '#CDBBA6'} strokeWidth={touched ? 2.4 : 2} />
                      </View>
                      <Text style={[styles.label, focused ? styles.labelActive : touched && styles.labelTouched]}>{tab.label}</Text>
                    </View>
                  )
                }}
              </Pressable>
            )
          })}
        </View>
      </View>
    </View>
  )
}

const MASCOT = require('../../assets/brand/mascot.png')
const COIN_SIZE = 78 // the coin's face is ~76% of this (room for its edge and sparks): about the old 56 px button
// Opening Add: the coin is tossed (spinning, slowing down) and on its way down it turns into the
// drawer, which lands with a small bounce. Leaving Add: the drawer turns straight back into the coin.
// "Turns into" is a quick morph: one shrinks and fades as the other grows in. Only the coin spins.
const COIN_SPIN = { degrees: 1080, duration: 600, easing: Easing.out(Easing.cubic) }
const TOSS_UP = { duration: 240, easing: Easing.out(Easing.quad) }
const LAND = { duration: 420, easing: Easing.bounce }
const MORPH = { duration: 260, easing: Easing.inOut(Easing.quad) }

/**
 * The centre button: a DROIN coin with a "+". Tapping it opens Add: the coin is tossed and becomes the
 * drawer (the mascot) as it comes down; leaving Add turns it back into the coin.
 */
function AddCoin({ open, onPress }: { open: boolean; onPress: () => void }) {
  const styles = useStyles()
  const morph = useSharedValue(open ? 1 : 0) // 0 = coin, 1 = drawer
  const spin = useSharedValue(0) // the coin's own spin, in degrees (whole turns, so it ends face-on)
  const toss = useSharedValue(0) // px up

  useEffect(() => {
    if (open) {
      spin.value = 0
      spin.value = withTiming(COIN_SPIN.degrees, COIN_SPIN)
      toss.value = withSequence(withTiming(-16, TOSS_UP), withTiming(0, LAND))
      // Starts as the coin reaches the top, so the change happens while it falls.
      morph.value = withDelay(TOSS_UP.duration, withTiming(1, MORPH))
    } else {
      spin.value = 0
      toss.value = withTiming(0, { duration: 120 })
      morph.value = withTiming(0, MORPH)
    }
  }, [open, morph, spin, toss])

  const lift = useAnimatedStyle(() => ({
    transform: [{ translateY: toss.value }, { scale: interpolate(toss.value, [-16, 0], [1.1, 1]) }],
  }))
  const coinFace = useAnimatedStyle(() => ({
    opacity: interpolate(morph.value, [0.5, 1], [1, 0], Extrapolation.CLAMP), // fades once the drawer covers it
    transform: [{ perspective: 500 }, { rotateY: `${spin.value}deg` }, { scale: interpolate(morph.value, [0, 1], [1, 0.6]) }],
  }))
  const drawerFace = useAnimatedStyle(() => ({
    opacity: interpolate(morph.value, [0, 0.5], [0, 1], Extrapolation.CLAMP), // on top, so it fades in first
    transform: [{ scale: interpolate(morph.value, [0, 1], [0.6, 1]) }],
  }))

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Put something in"
      accessibilityState={{ selected: open }}
      hitSlop={8}
      style={styles.addWrap}
    >
      {({ pressed }) => (
        <View style={{ transform: [{ scale: pressed ? 0.92 : 1 }] }}>
          <Animated.View style={[styles.addSlot, lift]}>
            <Animated.View style={[styles.addFace, coinFace]}>
              <Coin size={COIN_SIZE} mark="plus" />
            </Animated.View>
            <Animated.View style={[styles.addFace, drawerFace]}>
              <Image source={MASCOT} style={styles.addDrawer} resizeMode="contain" />
            </Animated.View>
          </Animated.View>
        </View>
      )}
    </Pressable>
  )
}

const useStyles = makeStyles((Colors) => ({
  // Room above the bar for the floating circle and the raised "+". The bar itself runs to the bottom edge.
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 30 },
  shape: { position: 'absolute', top: 0, left: 0 },
  row: { flexDirection: 'row', height: BAR_HEIGHT },
  item: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 9 },
  itemInner: { alignItems: 'center', gap: 4 },
  label: { fontSize: 11, fontFamily: Fonts.bold, color: '#CDBBA6' },
  labelTouched: { color: Colors.face },
  labelActive: { fontFamily: Fonts.black, color: Colors.orange },
  bubble: {
    position: 'absolute',
    top: NOTCH_DEPTH - BUBBLE - 5,
    left: 0,
    width: BUBBLE,
    height: BUBBLE,
    borderRadius: BUBBLE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.orange,
    borderWidth: 2,
    borderColor: Colors.ink,
    zIndex: 2,
  },
  // Raised out of the bar like the mascot itself: orange box, ink mark, shaded ledge underneath.
  // The coin sits raised out of the bar, where the "+" button was.
  addWrap: { marginBottom: 8, padding: 2 },
  addSlot: { width: COIN_SIZE, height: COIN_SIZE, alignItems: 'center', justifyContent: 'center' },
  addFace: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  addDrawer: { width: COIN_SIZE, height: COIN_SIZE * (419 / 506) },
}))
