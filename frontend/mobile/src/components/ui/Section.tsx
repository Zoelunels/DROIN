import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { Fonts, makeStyles } from '@/constants/colors'

/** A screen's big title, with an optional small line above it ("Tuesday, 20 October"). */
export function PageTitle({ title, eyebrow, right }: { title: string; eyebrow?: string; right?: React.ReactNode }) {
  const styles = useStyles()
  return (
    <View style={styles.pageRow}>
      <View style={styles.pageText}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.pageTitle} numberOfLines={1} accessibilityRole="header">
          {title}
        </Text>
      </View>
      {right}
    </View>
  )
}

/** A section heading with an optional link on the right ("See all"). */
export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  const styles = useStyles()
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button">
          {({ pressed }) => <Text style={[styles.action, pressed && { opacity: 0.5 }]}>{action}</Text>}
        </Pressable>
      ) : null}
    </View>
  )
}

const useStyles = makeStyles((Colors) => ({
  pageRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  pageText: { flex: 1, gap: 1 },
  eyebrow: { fontSize: 13, fontFamily: Fonts.bold, color: Colors.secondaryGray },
  pageTitle: { fontSize: 30, fontFamily: Fonts.black, color: Colors.charcoal, letterSpacing: -0.6 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 18, fontFamily: Fonts.black, color: Colors.charcoal, letterSpacing: -0.2 },
  action: { fontSize: 14, fontFamily: Fonts.extrabold, color: Colors.orangeDeep },
}))
