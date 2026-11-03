import React from 'react'
import { Pressable, Text, View } from 'react-native'
import { Fonts, makeStyles, useColors, type Palette } from '@/constants/colors'
import type { TransactionType } from '@/types/api'

/** The app's one wording for transaction types: money In (income) and money Out (expense). */
export const TYPE_LABEL: Record<TransactionType, string> = { income: 'In', expense: 'Out' }
/** In is green, Out is red, in the active theme's shades. */
export const typeColor = (Colors: Palette, type: TransactionType) => (type === 'income' ? Colors.income : Colors.expense)

/** Segmented In | Out switch. */
export function TypeToggle({
  value,
  onChange,
}: {
  value: TransactionType
  onChange: (type: TransactionType) => void
}) {
  const Colors = useColors()
  const styles = useStyles()
  return (
    <View style={styles.segment} accessibilityRole="radiogroup">
      {(['income', 'expense'] as const).map((t) => {
        const on = value === t
        return (
          <Pressable
            key={t}
            onPress={() => on || onChange(t)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={[styles.item, on && styles.itemOn]}
          >
            <Text style={[styles.text, on && { color: typeColor(Colors, t) }]}>{TYPE_LABEL[t]}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

const useStyles = makeStyles((Colors) => ({
  segment: { flexDirection: 'row', padding: 3, borderRadius: 12, backgroundColor: Colors.cream, alignSelf: 'flex-start' },
  item: { paddingHorizontal: 18, height: 32, borderRadius: 9, justifyContent: 'center' },
  itemOn: {
    backgroundColor: Colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  text: { fontSize: 14, fontFamily: Fonts.bold, color: Colors.secondaryGray },
}))
