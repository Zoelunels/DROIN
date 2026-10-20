import React from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Colors } from '@/constants/colors'
import { categoryEmoji, walletEmoji } from '@/lib/emoji'
import { asEmoji, dayLabel, groupDigits as thousands, localDate } from '@/lib/display'
import type { Category, QuickDraft, TransactionType, Wallet } from '@/types/api'

/** A parsed draft the user can fix before saving. Amount is kept as typed digits. */
export interface EditableDraft {
  key: string // also the Idempotency-Key, so a retried save never saves twice
  amountText: string
  type: TransactionType
  categoryId: number | null
  walletId: number | null
  date: string
  note: string
  guessed: { amount: boolean; category: boolean; wallet: boolean }
  saved?: boolean
}

export function toEditable(draft: QuickDraft): EditableDraft {
  return {
    key: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    amountText: draft.amount ? String(Math.round(draft.amount)) : '',
    type: draft.type,
    categoryId: draft.category_id,
    walletId: draft.wallet_id,
    date: draft.transaction_date,
    note: draft.note ?? '',
    guessed: {
      amount: !draft.matched.amount,
      category: draft.matched.category === 'none',
      wallet: draft.matched.wallet !== 'name',
    },
  }
}

export function draftAmount(d: EditableDraft) {
  return Number(d.amountText || 0)
}

/** What still stops this draft from being saved, in plain words. */
export function draftProblem(d: EditableDraft): string | null {
  if (draftAmount(d) <= 0) return 'How much was it?'
  if (!d.categoryId) return 'Pick a category.'
  if (!d.walletId) return 'Pick a wallet.'
  return null
}


type ChipTone = 'neutral' | 'income' | 'expense' | 'brand'
const CHIP_ACTIVE: Record<ChipTone, string> = {
  neutral: Colors.charcoal,
  income: Colors.income,
  expense: Colors.expense,
  brand: Colors.orange,
}

/** A selectable chip: 36 px tall, 10 px radius, filled when picked. */
function Chip({
  label,
  emoji,
  active,
  tone = 'neutral',
  onPress,
}: {
  label: string
  emoji?: string | null
  active?: boolean
  tone?: ChipTone
  onPress?: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [
        styles.chip,
        active && { backgroundColor: CHIP_ACTIVE[tone], borderColor: CHIP_ACTIVE[tone] },
        pressed && !active && styles.chipPressed,
      ]}
    >
      {emoji ? <Text style={styles.chipEmoji}>{emoji}</Text> : null}
      <Text numberOfLines={1} style={[styles.chipText, active && styles.chipTextActive]}>
        {label}
      </Text>
    </Pressable>
  )
}

function Label({ children, hint }: { children: string; hint?: string | null }) {
  return (
    <View style={styles.labelRow}>
      <Text style={styles.label}>{children}</Text>
      {hint ? <Text style={styles.labelHint}>{hint}</Text> : null}
    </View>
  )
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.chipRow}
      style={styles.chipScroll}
    >
      {children}
    </ScrollView>
  )
}

export function DraftCard({
  draft,
  wallets,
  categories,
  onChange,
  onRemove,
  onCreateWallet,
}: {
  draft: EditableDraft
  wallets: Wallet[]
  categories: Category[]
  onChange: (patch: Partial<EditableDraft>) => void
  onRemove?: () => void
  onCreateWallet: () => void
}) {
  // The picked one first, so it is visible without scrolling.
  const typeCategories = categories
    .filter((c) => c.type === draft.type)
    .sort((a, b) => Number(b.id === draft.categoryId) - Number(a.id === draft.categoryId))
  const sortedWallets = [...wallets].sort(
    (a, b) => Number(b.id === draft.walletId) - Number(a.id === draft.walletId),
  )
  const dateChoices = [
    { label: 'Today', value: localDate(0) },
    { label: 'Yesterday', value: localDate(-1) },
    { label: '2 days ago', value: localDate(-2) },
  ]
  const customDate = !dateChoices.some((c) => c.value === draft.date)
  const income = draft.type === 'income'

  if (draft.saved) {
    return (
      <View style={[styles.card, styles.savedCard]}>
        <Text style={styles.savedEmoji}>🗄️</Text>
        <Text style={styles.savedText} numberOfLines={1}>
          {draft.note || 'Entry'} · Rp {thousands(draft.amountText)}
        </Text>
        <Text style={styles.savedBadge}>In the drawer</Text>
      </View>
    )
  }

  return (
    <View style={styles.card}>
      <View style={styles.topRow}>
        <View style={styles.segment}>
          {(['expense', 'income'] as const).map((t) => {
            const on = draft.type === t
            return (
              <Pressable
                key={t}
                onPress={() => on || onChange({ type: t, categoryId: null })}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                style={[styles.segmentItem, on && styles.segmentItemOn]}
              >
                <Text style={[styles.segmentText, on && { color: t === 'income' ? Colors.income : Colors.expense }]}>
                  {t === 'income' ? 'Got' : 'Spent'}
                </Text>
              </Pressable>
            )
          })}
        </View>
        {onRemove ? (
          <Pressable onPress={onRemove} hitSlop={10} accessibilityRole="button">
            {({ pressed }) => <Text style={[styles.remove, pressed && { opacity: 0.5 }]}>Remove</Text>}
          </Pressable>
        ) : null}
      </View>

      <View style={styles.field}>
        <Label hint={draft.guessed.amount && !draft.amountText ? 'Not heard' : null}>Amount</Label>
        <View style={styles.amountRow}>
          <Text style={[styles.currency, { color: income ? Colors.income : Colors.expense }]}>Rp</Text>
          <TextInput
            style={styles.amount}
            value={thousands(draft.amountText)}
            onChangeText={(t) => onChange({ amountText: t.replace(/\D/g, '').slice(0, 13) })}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor="#C9C3B9"
            selectionColor={Colors.orange}
          />
        </View>
      </View>

      <View style={styles.field}>
        <Label hint={draft.guessed.category && !draft.categoryId ? 'Pick one' : null}>Category</Label>
        <ChipRow>
          {typeCategories.map((c) => (
            <Chip
              key={c.id}
              label={c.name}
              emoji={asEmoji(c.icon) ?? categoryEmoji(c.name)}
              active={c.id === draft.categoryId}
              tone={income ? 'income' : 'expense'}
              onPress={() => onChange({ categoryId: c.id, guessed: { ...draft.guessed, category: false } })}
            />
          ))}
        </ChipRow>
      </View>

      <View style={styles.field}>
        <Label hint={draft.guessed.wallet && draft.walletId ? 'Guessed' : null}>Wallet</Label>
        <ChipRow>
          {sortedWallets.map((w) => (
            <Chip
              key={w.id}
              label={w.name}
              emoji={asEmoji(w.icon) ?? walletEmoji(w.name, w.wallet_type)}
              active={w.id === draft.walletId}
              onPress={() => onChange({ walletId: w.id, guessed: { ...draft.guessed, wallet: false } })}
            />
          ))}
          {wallets.length === 0 ? (
            <Chip label="Make a Cash wallet" emoji="➕" tone="brand" active onPress={onCreateWallet} />
          ) : null}
        </ChipRow>
      </View>

      <View style={styles.field}>
        <Label>When</Label>
        <ChipRow>
          {customDate ? <Chip label={dayLabel(draft.date)} active /> : null}
          {dateChoices.map((c) => (
            <Chip key={c.value} label={c.label} active={c.value === draft.date} onPress={() => onChange({ date: c.value })} />
          ))}
        </ChipRow>
      </View>

      <View style={styles.field}>
        <Label>Note</Label>
        <TextInput
          style={styles.note}
          value={draft.note}
          onChangeText={(t) => onChange({ note: t.slice(0, 500) })}
          placeholder="What was it?"
          placeholderTextColor="#ABA59C"
          selectionColor={Colors.orange}
        />
      </View>
    </View>
  )
}

// Web only: hide the browser focus outline. Native has no "none" outline value.
const WEB_NO_OUTLINE = Platform.select({ web: { outlineStyle: 'none' }, default: {} })

const styles = StyleSheet.create({
  card: {
    gap: 16,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.white,
  },
  savedCard: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, backgroundColor: Colors.cream },
  savedEmoji: { fontSize: 18 },
  savedText: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.charcoal },
  savedBadge: { fontSize: 13, fontWeight: '700', color: Colors.income },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  segment: { flexDirection: 'row', padding: 3, borderRadius: 12, backgroundColor: Colors.cream },
  segmentItem: { paddingHorizontal: 16, height: 32, borderRadius: 9, justifyContent: 'center' },
  segmentItemOn: {
    backgroundColor: Colors.white,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentText: { fontSize: 14, fontWeight: '700', color: Colors.secondaryGray },
  remove: { fontSize: 14, fontWeight: '600', color: Colors.secondaryGray },
  field: { gap: 8 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.secondaryGray },
  labelHint: { fontSize: 12, fontWeight: '700', color: '#C9853A' },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1.5,
    borderBottomColor: Colors.borderLight,
  },
  currency: { fontSize: 24, fontWeight: '800' },
  amount: {
    flex: 1,
    fontSize: 32,
    fontWeight: '800',
    color: Colors.charcoal,
    paddingVertical: 4,
    letterSpacing: -0.5,
    includeFontPadding: false,
    ...WEB_NO_OUTLINE,
  } as object,
  // Bleeds to the card edges so chips scroll under the padding instead of being clipped.
  chipScroll: { marginHorizontal: -16 },
  chipRow: { gap: 8, paddingHorizontal: 16 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.white,
  },
  chipPressed: { backgroundColor: Colors.cream },
  chipEmoji: { fontSize: 15 },
  chipText: { fontSize: 14, fontWeight: '600', color: Colors.charcoal },
  chipTextActive: { color: Colors.white },
  note: {
    height: 46,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: Colors.cream,
    fontSize: 16,
    color: Colors.charcoal,
    includeFontPadding: false,
    ...WEB_NO_OUTLINE,
  } as object,
})
