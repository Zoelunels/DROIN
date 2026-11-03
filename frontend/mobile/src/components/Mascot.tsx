import React, { useEffect, useState } from 'react'
import { AccessibilityInfo, Animated, Easing, Image, Text, View } from 'react-native'
import Svg, { Circle, Path } from 'react-native-svg'
import { Fonts, makeStyles, useTheme } from '@/constants/colors'

type Mood = 'happy' | 'wink' | 'cheer' | 'sleepy' | 'sad' | 'curious'

export interface MascotProps {
  size?: number
  mood?: Mood
  animated?: boolean
  /** Kept for older call sites: the artwork always has its two sparks. */
  sparkle?: boolean
  /** Every few seconds the drawer flips over into a DROIN coin, then flips back. */
  flipToCoin?: boolean
}

// The coin's own spin when it shows: three quick turns (whole turns, so it ends face-on), slowing down.
const COIN_SPIN_DEG = 1080

const INK = '#2E1F17'
const ORANGE = '#F3943A'
const SHADE = '#C47028'
const CREAM = '#F8E8CC'

/** A DROIN coin in the mascot's style: orange rim, cream face panel, ink outline, shaded edge, the same smile and sparks. */
export function Coin({ size, mark = 'face' }: { size: number; mark?: 'face' | 'plus' }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* the coin's edge, seen below the face, like the drawer's shaded side */}
      <Circle cx={50} cy={55} r={38} fill={SHADE} stroke={INK} strokeWidth={4} />
      <Circle cx={50} cy={49} r={38} fill={ORANGE} stroke={INK} strokeWidth={4} />
      {/* the cream face panel, like the drawer's front, and a shine on the orange rim */}
      <Circle cx={50} cy={49} r={28} fill={CREAM} stroke={INK} strokeWidth={3} />
      <Path d="M19.5 38 Q21 25 32 20.5" stroke={CREAM} strokeWidth={3.5} strokeLinecap="round" fill="none" />
      {mark === 'plus' ? (
        // On the add button the face carries a "+", so the button says what it does.
        <Path d="M50 37 V61 M38 49 H62" stroke={INK} strokeWidth={6} strokeLinecap="round" />
      ) : (
        <>
          <Circle cx={40} cy={47} r={4.5} fill={INK} />
          <Circle cx={60} cy={47} r={4.5} fill={INK} />
          <Path d="M42 57 Q50 64 58 57" stroke={INK} strokeWidth={4} strokeLinecap="round" fill="none" />
        </>
      )}
      {/* the two sparks from the mascot artwork */}
      <Path d="M80 17 L85 6" stroke={ORANGE} strokeWidth={5} strokeLinecap="round" />
      <Path d="M87 25 L96 18" stroke={ORANGE} strokeWidth={5} strokeLinecap="round" />
    </Svg>
  )
}

// The brand mascot (assets/brand/droin_drawer_mascot.png, trimmed by the icon script).
const ART = require('../../assets/brand/mascot.png')
const RATIO = 419 / 506

/** Respects the system "reduce motion" setting: the mascot then sits still. */
function useReduceMotion() {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduce).catch(() => {})
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce)
    return () => sub.remove()
  }, [])
  return reduce
}

const loop = (steps: Animated.CompositeAnimation[]) => Animated.loop(Animated.sequence(steps))
const ease = Easing.inOut(Easing.quad)
const to = (v: Animated.Value, toValue: number, duration: number, easing = ease) =>
  Animated.timing(v, { toValue, duration, easing, useNativeDriver: true })

/**
 * The DROIN mascot, drawn from the brand artwork so it is always the real character. Moods are
 * motion, not new faces: happy bobs, cheer hops, curious tilts its head, sad droops, sleepy breathes.
 */
export function Mascot({ size = 140, mood = 'happy', animated = true, flipToCoin = false }: MascotProps) {
  const reduce = useReduceMotion()
  const [t] = useState(() => new Animated.Value(0)) // 0..1 phase used by every mood
  const [flip] = useState(() => new Animated.Value(0)) // the morph: 0 = drawer, 1 = coin
  const [spin] = useState(() => new Animated.Value(0)) // the coin's own spin, in degrees
  const [toss] = useState(() => new Animated.Value(0)) // how far the coin is tossed up, 0..1
  const height = size * RATIO

  // Drawer → coin → drawer. The drawer quickly turns into the coin (one shrinks and fades as the other
  // grows in); the coin is tossed, spinning, and on its way down turns straight back into the drawer,
  // which lands with a small bounce. No pauses in between. Only the coin spins.
  useEffect(() => {
    flip.setValue(0)
    spin.setValue(0)
    toss.setValue(0)
    if (!flipToCoin || !animated || reduce) return
    const native = { useNativeDriver: true }
    const morph = (toValue: number) => Animated.timing(flip, { toValue, duration: 260, easing: Easing.inOut(Easing.quad), ...native })
    const TOSS_UP = 240
    const coinToss = Animated.parallel([
      Animated.timing(spin, { toValue: COIN_SPIN_DEG, duration: 600, easing: Easing.out(Easing.cubic), ...native }),
      Animated.sequence([
        Animated.timing(toss, { toValue: 1, duration: TOSS_UP, easing: Easing.out(Easing.quad), ...native }),
        Animated.timing(toss, { toValue: 0, duration: 420, easing: Easing.bounce, ...native }),
      ]),
      // Starts as the coin reaches the top, so it becomes the drawer while it falls.
      Animated.sequence([Animated.delay(TOSS_UP), morph(0)]),
    ])
    const reset = Animated.timing(spin, { toValue: 0, duration: 0, ...native })
    const anim = loop([Animated.delay(3200), morph(1), coinToss, reset])
    anim.start()
    return () => anim.stop()
  }, [flipToCoin, animated, reduce, flip, spin, toss])

  useEffect(() => {
    t.setValue(0)
    if (!animated || reduce) return
    const anim =
      mood === 'cheer'
        ? loop([to(t, 1, 260, Easing.out(Easing.quad)), to(t, 0, 320, Easing.bounce), Animated.delay(900)])
        : mood === 'curious' || mood === 'wink'
          ? loop([to(t, 1, 700), Animated.delay(500), to(t, 0, 700), Animated.delay(900)])
          : mood === 'sleepy' || mood === 'sad'
            ? loop([to(t, 1, 1800), to(t, 0, 1800)])
            : loop([to(t, 1, 1200), to(t, 0, 1200)])
    anim.start()
    return () => anim.stop()
  }, [animated, reduce, mood, t])

  const transform =
    mood === 'cheer'
      ? [
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -height * 0.16] }) },
          { scaleY: t.interpolate({ inputRange: [0, 0.15, 1], outputRange: [1, 0.94, 1.03] }) },
        ]
      : mood === 'curious' || mood === 'wink'
        ? [{ rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', mood === 'wink' ? '6deg' : '-8deg'] }) }]
        : mood === 'sad'
          ? [{ rotate: '-6deg' }, { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [height * 0.04, height * 0.07] }) }]
          : mood === 'sleepy'
            ? [{ scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1.02] }) }]
            : [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, -height * 0.05] }) }]

  return (
    <View style={{ width: size, height }} accessible accessibilityRole="image" accessibilityLabel="DROIN mascot">
      <Animated.View style={{ transform }}>
        {flipToCoin ? (
          // Both faces are drawn and cross-fade (one shrinks as the other grows in). The toss lifts the
          // coin a little while it spins.
          <Animated.View
            style={{
              transform: [
                { translateY: toss.interpolate({ inputRange: [0, 1], outputRange: [0, -height * 0.16] }) },
                { scale: toss.interpolate({ inputRange: [0, 1], outputRange: [1, 1.1] }) },
              ],
            }}
          >
            <Animated.View
              style={{
                opacity: flip.interpolate({ inputRange: [0.5, 1], outputRange: [1, 0], extrapolate: 'clamp' }), // fades once the coin covers it
                transform: [{ scale: flip.interpolate({ inputRange: [0, 1], outputRange: [1, 0.6] }) }],
              }}
            >
              <Image source={ART} style={{ width: size, height }} resizeMode="contain" />
            </Animated.View>
            <Animated.View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: size,
                height,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: flip.interpolate({ inputRange: [0, 0.5], outputRange: [0, 1], extrapolate: 'clamp' }), // on top, so it fades in first
                transform: [
                  { perspective: 600 },
                  { rotateY: spin.interpolate({ inputRange: [0, COIN_SPIN_DEG], outputRange: ['0deg', `${COIN_SPIN_DEG}deg`] }) },
                  { scale: flip.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
                ],
              }}
            >
              <Coin size={height * 1.02} />
            </Animated.View>
          </Animated.View>
        ) : (
          <Image source={ART} style={{ width: size, height }} resizeMode="contain" />
        )}
      </Animated.View>
      {mood === 'sleepy' ? <Zzz size={size} t={t} /> : null}
    </View>
  )
}

function Zzz({ size, t }: { size: number; t: Animated.Value }) {
  const styles = useStyles()
  const rise = t.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.08] })
  return (
    <Animated.Text
      style={[
        styles.z,
        { fontSize: size * 0.16, right: size * 0.02, top: -size * 0.04, opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) },
        { transform: [{ translateY: rise }] },
      ]}
    >
      z<Text style={{ fontSize: size * 0.11 }}>z</Text>
    </Animated.Text>
  )
}

/**
 * The DROIN wordmark (assets/brand/droin_wordmark.png): use it wherever the name is the logo. Light
 * mode shows it as drawn (brown letters); dark mode uses a recoloured copy with orange letters and an
 * ink face, so it stands out on the dark page (assets/brand/wordmark-dark.png, same artwork).
 */
const WORDMARK = require('../../assets/brand/wordmark.png')
const WORDMARK_DARK = require('../../assets/brand/wordmark-dark.png')
export function Wordmark({ width = 120 }: { width?: number }) {
  const { scheme } = useTheme()
  return (
    <Image
      source={scheme === 'dark' ? WORDMARK_DARK : WORDMARK}
      style={{ width, height: width * (325 / 1013) }}
      resizeMode="contain"
      accessibilityRole="image"
      accessibilityLabel="DROIN"
    />
  )
}

const useStyles = makeStyles((Colors) => ({
  z: { position: 'absolute', fontFamily: Fonts.black, color: Colors.orangeDeep },
}))
