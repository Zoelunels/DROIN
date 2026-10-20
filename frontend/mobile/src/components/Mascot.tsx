import React, { useEffect, useRef } from 'react'
import { Animated, Easing, View } from 'react-native'
import type { ViewStyle } from 'react-native'

type Mood = 'happy' | 'wink' | 'cheer' | 'sleepy' | 'sad' | 'curious'

export interface MascotProps {
  size?: number
  mood?: Mood
  animated?: boolean
  sparkle?: boolean
}

const MOOD_FACE: Record<Mood, { eye: string; mouth: string }> = {
  happy: { eye: 'eyes', mouth: 'smile' },
  wink: { eye: 'wink', mouth: 'smile' },
  cheer: { eye: 'happy', mouth: 'open' },
  sleepy: { eye: 'closed', mouth: 'small' },
  sad: { eye: 'sad', mouth: 'frown' },
  curious: { eye: 'eyes', mouth: 'o' },
}

const INK = '#4A3423'
const ROUND = 999

/** The DROIN drawer mascot, drawn with plain views so it scales crisply at any size. */
export function Mascot({
  size = 140,
  mood = 'happy',
  animated = true,
  sparkle = true,
}: MascotProps) {
  const width = size
  const height = size * 0.92
  const face = MOOD_FACE[mood]

  const bob = useRef(new Animated.Value(0)).current

  useEffect(() => {
    if (!animated) {
      bob.setValue(0)
      return
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, {
          toValue: -height * 0.05,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(bob, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    )
    loop.start()
    return () => loop.stop()
  }, [animated, bob, height])

  return (
    <Animated.View style={{ transform: [{ translateY: bob }] }}>
      <View style={{ width, height, alignItems: 'center', justifyContent: 'flex-end' }}>
        {sparkle ? (
          <>
            <Sparkle style={{ left: width * 0.02, top: height * 0.12 }} size={width * 0.1} />
            <Sparkle style={{ right: width * 0.04, top: height * 0.02 }} size={width * 0.13} />
            <Sparkle style={{ right: width * 0.14, top: height * 0.3 }} size={width * 0.07} />
          </>
        ) : null}

        {/* drawer body */}
        <View
          style={{
            width: width * 0.72,
            height: height * 0.78,
            backgroundColor: '#F0C094',
            borderWidth: width * 0.02,
            borderColor: '#C98A4E',
            borderRadius: width * 0.14,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            shadowColor: '#C9853A',
            shadowOffset: { width: 0, height: width * 0.03 },
            shadowOpacity: 1,
            shadowRadius: 0,
            elevation: 6,
          }}
        >
          {/* top panel highlight */}
          <View
            style={{
              position: 'absolute',
              top: height * 0.05,
              left: width * 0.06,
              right: width * 0.06,
              height: height * 0.06,
              backgroundColor: '#FAD7B7',
              borderRadius: width * 0.03,
              opacity: 0.9,
            }}
          />

          {/* the drawer front (slightly lighter panel) */}
          <View
            style={{
              width: width * 0.56,
              height: height * 0.46,
              backgroundColor: '#FAD7B7',
              borderRadius: width * 0.08,
              alignItems: 'center',
              justifyContent: 'center',
              gap: height * 0.02,
              borderWidth: width * 0.012,
              borderColor: '#E8A04A',
            }}
          >
            {/* eyes */}
            <View style={{ flexDirection: 'row', gap: width * 0.1, alignItems: 'center', height: height * 0.1 }}>
              <Eye kind={face.eye} size={width * 0.075} side="left" />
              <Eye kind={face.eye} size={width * 0.075} side="right" />
            </View>

            {/* mouth */}
            <Mouth kind={face.mouth} size={width * 0.12} />

            {/* drawer handle */}
            <View
              style={{
                width: width * 0.16,
                height: width * 0.035,
                backgroundColor: '#C98A4E',
                borderRadius: ROUND,
                marginTop: height * 0.01,
              }}
            />
          </View>
        </View>

        {/* little feet */}
        <View style={{ flexDirection: 'row', gap: width * 0.14, marginTop: -width * 0.01 }}>
          <View style={{ width: width * 0.12, height: width * 0.06, backgroundColor: '#C98A4E', borderRadius: ROUND }} />
          <View style={{ width: width * 0.12, height: width * 0.06, backgroundColor: '#C98A4E', borderRadius: ROUND }} />
        </View>
      </View>
    </Animated.View>
  )
}

function Eye({ kind, size, side }: { kind: string; size: number; side: 'left' | 'right' }) {
  if (kind === 'closed' || (kind === 'wink' && side === 'right')) {
    return <View style={{ width: size, height: size * 0.22, backgroundColor: INK, borderRadius: ROUND }} />
  }
  if (kind === 'happy') {
    return (
      <View
        style={{
          width: size,
          height: size * 0.55,
          borderTopWidth: size * 0.22,
          borderLeftWidth: size * 0.22,
          borderRightWidth: size * 0.22,
          borderColor: INK,
          borderTopLeftRadius: ROUND,
          borderTopRightRadius: ROUND,
        }}
      />
    )
  }
  if (kind === 'sad') {
    return <View style={{ width: size, height: size * 0.55, backgroundColor: INK, borderRadius: ROUND, opacity: 0.85 }} />
  }
  return (
    <View style={{ width: size, height: size, backgroundColor: INK, borderRadius: ROUND }}>
      <View
        style={{
          position: 'absolute',
          width: size * 0.35,
          height: size * 0.35,
          backgroundColor: '#FFFFFF',
          borderRadius: ROUND,
          top: size * 0.12,
          left: size * 0.12,
        }}
      />
    </View>
  )
}

function Mouth({ kind, size }: { kind: string; size: number }) {
  if (kind === 'smile') {
    return (
      <View
        style={{
          width: size,
          height: size * 0.5,
          borderBottomWidth: size * 0.16,
          borderLeftWidth: size * 0.16,
          borderRightWidth: size * 0.16,
          borderColor: INK,
          borderBottomLeftRadius: ROUND,
          borderBottomRightRadius: ROUND,
        }}
      />
    )
  }
  if (kind === 'open') {
    return <View style={{ width: size * 0.7, height: size * 0.7, backgroundColor: INK, borderRadius: ROUND }} />
  }
  if (kind === 'frown') {
    return (
      <View
        style={{
          width: size * 0.8,
          height: size * 0.4,
          borderTopWidth: size * 0.16,
          borderLeftWidth: size * 0.16,
          borderRightWidth: size * 0.16,
          borderColor: INK,
          borderTopLeftRadius: ROUND,
          borderTopRightRadius: ROUND,
        }}
      />
    )
  }
  if (kind === 'o') {
    return <View style={{ width: size * 0.4, height: size * 0.4, backgroundColor: INK, borderRadius: ROUND }} />
  }
  return <View style={{ width: size * 0.5, height: size * 0.12, backgroundColor: INK, borderRadius: ROUND }} />
}

function Sparkle({ size, style }: { size: number; style?: ViewStyle }) {
  return (
    <View style={[{ position: 'absolute', width: size, height: size, alignItems: 'center', justifyContent: 'center' }, style]}>
      <View style={{ position: 'absolute', width: size, height: size * 0.24, backgroundColor: '#E8A04A', borderRadius: ROUND }} />
      <View style={{ position: 'absolute', width: size * 0.24, height: size, backgroundColor: '#E8A04A', borderRadius: ROUND }} />
    </View>
  )
}
