import React, { useEffect, useRef } from 'react'
import { ActivityIndicator, Animated, Easing, Pressable, Text, View } from 'react-native'
import { Icon } from '@/components/ui/Icon'
import { Fonts, makeStyles, useColors } from '@/constants/colors'

const SIZE = 112

/**
 * The big orange mic. Hold to talk (release to send) or tap once to start and again to stop.
 * While recording, a soft ring grows with the voice level.
 */
export function MicButton({
  recording,
  busy,
  soon,
  level,
  onPressIn,
  onPressOut,
}: {
  recording: boolean
  busy?: boolean
  /** Voice isn't available yet: muted look and a "Soon" badge; presses still reach the parent. */
  soon?: boolean
  level: number
  onPressIn: () => void
  onPressOut: () => void
}) {
  const Colors = useColors()
  const styles = useStyles()
  const ring = useRef(new Animated.Value(0)).current

  useEffect(() => {
    Animated.timing(ring, {
      toValue: recording ? 0.25 + level * 0.75 : 0,
      duration: 120,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start()
  }, [recording, level, ring])

  const scale = ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.55] })

  return (
    <View style={{ width: SIZE * 1.7, height: SIZE * 1.7, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          width: SIZE,
          height: SIZE,
          borderRadius: SIZE / 2,
          backgroundColor: Colors.softPeach,
          opacity: recording ? 0.9 : 0,
          transform: [{ scale }],
        }}
      />
      <Pressable
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={soon ? 'Voice input, coming soon' : recording ? 'Stop recording' : 'Hold to talk'}
        hitSlop={16}
        style={({ pressed }) => ({
          width: SIZE,
          height: SIZE,
          borderRadius: SIZE / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: soon ? Colors.softPeach : recording ? Colors.charcoal : Colors.orange,
          opacity: busy ? 0.6 : 1,
          transform: [{ scale: pressed ? 0.96 : 1 }],
          shadowColor: soon ? '#EBB98F' : '#C9853A',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: recording ? 0 : 1,
          shadowRadius: 0,
          elevation: recording ? 0 : 4,
        })}
      >
        {busy ? (
          <ActivityIndicator color="#FFFFFF" size="large" />
        ) : (
          <Icon name={recording ? 'stop' : 'mic'} size={recording ? 34 : 44} filled={recording} color={soon ? '#C9853A' : '#FFFFFF'} />
        )}
      </Pressable>
      {soon ? (
        <View pointerEvents="none" style={styles.badge}>
          <Text style={styles.badgeText}>SOON</Text>
        </View>
      ) : null}
    </View>
  )
}

const useStyles = makeStyles((Colors) => ({
  // Sits on the mic's lower edge, like a label on a drawer.
  badge: {
    position: 'absolute',
    bottom: SIZE * 0.35 - 11,
    paddingHorizontal: 10,
    height: 22,
    borderRadius: 8,
    justifyContent: 'center',
    backgroundColor: Colors.inkCard,
  },
  badgeText: { fontSize: 11, fontFamily: Fonts.extrabold, letterSpacing: 1.2, color: Colors.onColor },
}))
