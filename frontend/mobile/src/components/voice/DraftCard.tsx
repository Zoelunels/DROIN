import React, { useState } from 'react'
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { CategoryField, CategoryPicker } from '@/components/CategoryPicker'
import { TypeToggle } from '@/components/ui/TypeToggle'
import { card, Fonts, makeStyles, useColors, type Palette } from '@/constants/colors'
import { Icon, type IconName } from '@/components/ui/Icon'
import { walletIconName } from '@/lib/icons'
import { dayLabel, groupDigits as thousands, localDate } from '@/lib/display'
import type { Category, QuickDraft, Transaction, TransactionType, Wallet } from '@/types/api'

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

/** A saved transaction, opened for editing (nothing is a guess). */
export function fromTransaction(t: Transaction): EditableDraft {
  return {
    key: `edit-${t.id}`,
    amountText: String(Math.round(t.amount)),
    type: t.type,
    categoryId: t.category_id,
    walletId: t.wallet_id,
    date: t.transaction_date,
    note: t.note ?? '',
    guessed: { amount: false, category: false, wallet: false },
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
const CHIP_ACTIVE: Record<ChipTone, keyof Palette> = {
  neutral: 'charcoal',
  income: 'income',
  expense: 'expense',
  brand: 'orange',
}

/** A selectable chip: 36 px tall, 10 px radius, filled when picked. */
function Chip({
  label,
  icon,
  active,
  tone = 'neutral',
  onPress,
}: {
  label: string
  icon?: IconName | null
  active?: boolean
  tone?: ChipTone
  onPress?: () => void
}) {
  const Colors = useColors()
  const styles = useStyles()
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      style={({ pressed }) => [
        styles.chip,
        active && { backgroundColor: Colors[CHIP_ACTIVE[tone]], borderColor: Colors[CHIP_ACTIVE[tone]] },
        pressed && !active && styles.chipPressed,
      ]}
    >
      {icon ? <Icon name={icon} size={16} color={active ? (tone === 'brand' ? Colors.onOrange : Colors.surface) : Colors.charcoal} /> : null}
      <Text numberOfLines={1} style={[styles.chipText, active && { color: tone === 'brand' ? Colors.onOrange : Colors.surface }]}>
        {label}
      </Text>
    </Pressable>
  )
}

function Label({ children, hint }: { children: string; hint?: string | null }) {
  const styles = useStyles()
  return (
    <View style={styles.labelRow}>
      <Text style={styles.label}>{children}</Text>
      {hint ? <Text style={styles.labelHint}>{hint}</Text> : null}
    </View>
  )
}

function ChipRow({ children }: { children: React.ReactNode }) {
  const styles = useStyles()
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
  onCategoryCreated,
}: {
  draft: EditableDraft
  wallets: Wallet[]
  categories: Category[]
  onChange: (patch: Partial<EditableDraft>) => void
  onRemove?: () => void
  onCreateWallet: () => void
  onCategoryCreated: (category: Category) => void
}) {
  const Colors = useColors()
  const styles = useStyles()
  const [pickingCategory, setPickingCategory] = useState(false)
  const category = categories.find((c) => c.id === draft.categoryId) ?? null
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
        <Icon name="check-circle" size={20} color={Colors.income} strokeWidth={2.4} />
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
        <TypeToggle value={draft.type} onChange={(type) => onChange({ type, categoryId: null })} />
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
            placeholderTextColor={Colors.placeholder}
            selectionColor={Colors.orange}
          />
        </View>
      </View>

      <View style={styles.field}>
        <Label hint={draft.guessed.category && !draft.categoryId ? 'Pick one' : null}>Category</Label>
        <CategoryField category={category} hint={!category ? 'pick' : null} onPress={() => setPickingCategory(true)} />
        <CategoryPicker
          visible={pickingCategory}
          type={draft.type}
          categories={categories}
          selectedId={draft.categoryId}
          onSelect={(c) => onChange({ categoryId: c.id, guessed: { ...draft.guessed, category: false } })}
          onCreated={onCategoryCreated}
          onClose={() => setPickingCategory(false)}
        />
      </View>

      <View style={styles.field}>
        <Label hint={draft.guessed.wallet && draft.walletId ? 'Guessed' : null}>Wallet</Label>
        <ChipRow>
          {sortedWallets.map((w) => (
            <Chip
              key={w.id}
              label={w.name}
              icon={walletIconName(w)}
              active={w.id === draft.walletId}
              onPress={() => onChange({ walletId: w.id, guessed: { ...draft.guessed, wallet: false } })}
            />
          ))}
          {wallets.length === 0 ? (
            <Chip label="Make a Cash wallet" icon="add" tone="brand" active onPress={onCreateWallet} />
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
          placeholderTextColor={Colors.placeholder}
          selectionColor={Colors.orange}
        />
      </View>
    </View>
  )
}

// Web only: hide the browser focus outline. Native has no "none" outline value.
const WEB_NO_OUTLINE = Platform.select({ web: { outlineStyle: 'none' }, default: {} })

const useStyles = makeStyles((Colors) => ({
  card: { gap: 16, padding: 16, ...card(Colors) },
  savedCard: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, backgroundColor: Colors.cream },
  savedText: { flex: 1, fontSize: 15, fontFamily: Fonts.bold, color: Colors.charcoal },
  savedBadge: { fontSize: 13, fontFamily: Fonts.extrabold, color: Colors.income },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  remove: { fontSize: 14, fontFamily: Fonts.semibold, color: Colors.secondaryGray },
  field: { gap: 8 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 12, fontFamily: Fonts.extrabold, color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8 },
  labelHint: { fontSize: 12, fontFamily: Fonts.extrabold, color: Colors.orangeDeep },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: 1.5,
    borderBottomColor: Colors.borderLight,
  },
  currency: { fontSize: 24, fontFamily: Fonts.black },
  amount: {
    flex: 1,
    fontSize: 36,
    fontFamily: Fonts.black,
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
    backgroundColor: Colors.surface,
  },
  chipPressed: { backgroundColor: Colors.cream },
  chipText: { fontSize: 14, fontFamily: Fonts.bold, color: Colors.charcoal },
  note: {
    fontFamily: Fonts.regular, height: 46,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: Colors.cream,
    fontSize: 16,
    color: Colors.charcoal,
    includeFontPadding: false,
    ...WEB_NO_OUTLINE,
  } as object,
}))
