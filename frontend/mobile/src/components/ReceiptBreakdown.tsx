import React from 'react'
import { Platform, Pressable, Text, TextInput, View } from 'react-native'
import { Icon } from '@/components/ui/Icon'
import { card, Fonts, makeStyles, useColors } from '@/constants/colors'
import { groupDigits, money } from '@/lib/display'

/** One line of a receipt, as the user edits it (amount kept as typed digits). */
export interface EditableItem {
  key: string
  name: string
  amountText: string
}

/** one: a single entry · split: one entry per item · bill: shared with friends (a split bill) */
export type SaveMode = 'one' | 'split' | 'bill'

const newKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

export const toEditableItems = (items: { name: string; amount: number }[]): EditableItem[] =>
  items.map((i) => ({ key: newKey(), name: i.name, amountText: String(Math.round(i.amount)) }))

export const itemsTotal = (items: EditableItem[]) => items.reduce((sum, i) => sum + Number(i.amountText || 0), 0)

/** "Indomie Goreng 9.300, Aqua 600ml 8.000" — the breakdown as it goes into one entry's note. */
export function itemsNote(items: EditableItem[]): string {
  return items
    .filter((i) => i.name.trim() && Number(i.amountText) > 0)
    .map((i) => `${i.name.trim()} ${groupDigits(i.amountText)}`)
    .join(', ')
}

/**
 * The receipt's items: each name and amount can be fixed, removed or added. Underneath, how to save
 * them: as one entry (the items listed in its note) or as separate entries (one per item).
 */
export function ReceiptBreakdown({
  items,
  onChange,
  mode,
  onModeChange,
  entryAmount,
}: {
  items: EditableItem[]
  onChange: (items: EditableItem[]) => void
  mode: SaveMode
  onModeChange: (mode: SaveMode) => void
  /** The entry's amount, to show whether the items add up to it. */
  entryAmount: number
}) {
  const Colors = useColors()
  const styles = useStyles()
  const sum = itemsTotal(items)
  const off = mode === 'one' && entryAmount > 0 && sum > 0 ? entryAmount - sum : 0
  const update = (key: string, patch: Partial<EditableItem>) => onChange(items.map((i) => (i.key === key ? { ...i, ...patch } : i)))

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>On the receipt</Text>
        <Text style={styles.count}>
          {items.length} {items.length === 1 ? 'item' : 'items'}
        </Text>
      </View>

      {mode === 'one' ? (
        <>
          {items.map((item) => (
            <View key={item.key} style={styles.row}>
              <TextInput
                style={[styles.input, styles.name]}
                value={item.name}
                onChangeText={(name) => update(item.key, { name: name.slice(0, 60) })}
                placeholder="Item"
                placeholderTextColor={Colors.placeholder}
                selectionColor={Colors.orange}
                accessibilityLabel="Item name"
              />
              <TextInput
                style={[styles.input, styles.amount]}
                value={groupDigits(item.amountText)}
                onChangeText={(t) => update(item.key, { amountText: t.replace(/\D/g, '').slice(0, 12) })}
                keyboardType="number-pad"
                placeholder="0"
                placeholderTextColor={Colors.placeholder}
                selectionColor={Colors.orange}
                accessibilityLabel={`Amount for ${item.name || 'item'}`}
              />
              <Pressable
                onPress={() => onChange(items.filter((i) => i.key !== item.key))}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${item.name || 'item'}`}
                style={({ pressed }) => [styles.remove, pressed && { backgroundColor: Colors.cream }]}
              >
                <Icon name="close" size={16} color={Colors.secondaryGray} />
              </Pressable>
            </View>
          ))}

          <Pressable
            onPress={() => onChange([...items, { key: newKey(), name: '', amountText: '' }])}
            accessibilityRole="button"
            style={({ pressed }) => [styles.addRow, pressed && { opacity: 0.6 }]}
          >
            <Icon name="add" size={16} color={Colors.orangeDeep} strokeWidth={2.5} />
            <Text style={styles.addText}>Add item</Text>
          </Pressable>

          <View style={styles.sumRow}>
            <Text style={styles.sumLabel}>Items add up to</Text>
            <Text style={styles.sumValue}>{money(sum)}</Text>
          </View>
          {off !== 0 ? (
            <View style={styles.offRow}>
              <Icon name="alert" size={14} color={Colors.orangeDeep} />
              <Text style={styles.offText}>
                {money(Math.abs(off))} {off > 0 ? 'less than' : 'more than'} the total (tax, discount, or a misread line)
              </Text>
            </View>
          ) : null}
        </>
      ) : mode === 'split' ? (
        <Text style={styles.splitHint}>Each item is its own entry below. Pick a category for each, or change the amounts.</Text>
      ) : (
        <Text style={styles.splitHint}>Shared with friends: pick who had what below.</Text>
      )}

      <Text style={styles.saveLabel}>Save as</Text>
      <View style={styles.segment} accessibilityRole="radiogroup">
        {(
          [
            ['one', 'One entry', 'Items in the note'],
            ['split', 'Per item', `${items.length} entries`],
            ['bill', 'Split bill', 'With friends'],
          ] as const
        ).map(([value, label, hint]) => {
          const on = mode === value
          const off = value === 'split' && items.length < 2
          return (
            <Pressable
              key={value}
              onPress={() => on || onModeChange(value)}
              disabled={off}
              accessibilityRole="radio"
              accessibilityState={{ selected: on, disabled: off }}
              style={[styles.option, on && styles.optionOn, off && { opacity: 0.45 }]}
            >
              <Text style={[styles.optionLabel, on && styles.optionLabelOn]}>{label}</Text>
              <Text style={[styles.optionHint, on && styles.optionHintOn]} numberOfLines={1}>
                {hint}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

const WEB_NO_OUTLINE = Platform.select({ web: { outlineStyle: 'none' }, default: {} })

const useStyles = makeStyles((Colors) => ({
  card: { gap: 10, padding: 16, ...card(Colors) },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  title: { fontSize: 17, fontFamily: Fonts.black, color: Colors.charcoal },
  count: { fontSize: 13, fontFamily: Fonts.bold, color: Colors.secondaryGray },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: {
    height: 42,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surface,
    fontSize: 15,
    fontFamily: Fonts.semibold,
    color: Colors.charcoal,
    includeFontPadding: false,
    ...WEB_NO_OUTLINE,
  } as object,
  name: { flex: 1, minWidth: 0 },
  amount: { width: 104, textAlign: 'right', fontFamily: Fonts.extrabold, fontVariant: ['tabular-nums'] } as object,
  remove: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, alignSelf: 'flex-start' },
  addText: { fontSize: 14, fontFamily: Fonts.extrabold, color: Colors.orangeDeep },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.borderLight },
  sumLabel: { fontSize: 14, fontFamily: Fonts.bold, color: Colors.secondaryGray },
  sumValue: { fontSize: 15, fontFamily: Fonts.black, color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  offRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  offText: { flex: 1, fontSize: 12, fontFamily: Fonts.bold, color: Colors.orangeDeep },
  splitHint: { fontSize: 14, lineHeight: 20, fontFamily: Fonts.regular, color: Colors.secondaryGray },
  saveLabel: { marginTop: 4, fontSize: 12, fontFamily: Fonts.extrabold, color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8 },
  segment: { flexDirection: 'row', gap: 8 },
  option: { flex: 1, gap: 2, padding: 10, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.borderLight, backgroundColor: Colors.surface },
  optionOn: { backgroundColor: Colors.charcoal, borderColor: Colors.charcoal },
  optionLabel: { fontSize: 14, fontFamily: Fonts.extrabold, color: Colors.charcoal },
  optionLabelOn: { color: Colors.surface },
  optionHint: { fontSize: 11, fontFamily: Fonts.semibold, color: Colors.secondaryGray },
  optionHintOn: { color: Colors.cream },
}))
