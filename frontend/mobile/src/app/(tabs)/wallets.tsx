import React, { useCallback, useState } from 'react'
import { KeyboardAvoidingView, Platform, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Input } from '@/components/ui/Input'
import { Screen } from '@/components/ui/Screen'
import { Banner } from '@/components/ui/States'
import { Endpoints } from '@/constants/api'
import { Colors } from '@/constants/colors'
import { useScreenData } from '@/hooks/useScreenData'
import { ApiError, api } from '@/lib/api'
import { asEmoji, groupDigits, money } from '@/lib/display'
import { walletEmoji } from '@/lib/emoji'
import { notify } from '@/lib/toast'
import type { BalanceReport, WalletType } from '@/types/api'

const TYPES: { value: WalletType; label: string; emoji: string }[] = [
  { value: 'cash', label: 'Cash', emoji: '💵' },
  { value: 'bank', label: 'Bank', emoji: '🏦' },
  { value: 'ewallet', label: 'E-wallet', emoji: '📱' },
  { value: 'savings', label: 'Savings', emoji: '🐷' },
  { value: 'other', label: 'Other', emoji: '🗂️' },
]
const typeLabel = (t: WalletType) => TYPES.find((x) => x.value === t)?.label ?? 'Other'

export default function Wallets() {
  const load = useCallback(() => api.get<BalanceReport>(Endpoints.reportBalances), [])
  const { data, error, refreshing, refresh, reload } = useScreenData(load)

  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState<WalletType>('cash')
  const [opening, setOpening] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  function closeForm() {
    setAdding(false)
    setName('')
    setType('cash')
    setOpening('')
    setFormError(null)
  }

  async function save() {
    if (!name.trim()) {
      setFormError('Give it a name, like "BCA" or "GoPay".')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      await api.post(Endpoints.wallets, {
        name: name.trim(),
        wallet_type: type,
        opening_balance: Number(opening || 0),
      })
      notify.saved('Wallet')
      closeForm()
      reload()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'The drawer jammed. Try again?')
    } finally {
      setSaving(false)
    }
  }

  const wallets = data?.wallets ?? []

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        inTabs
        bottomSpace={24}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.orange} colors={[Colors.orange]} />}
      >
        <Text style={styles.title}>Wallets</Text>

        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>All wallets together</Text>
          <Text style={styles.total} numberOfLines={1} adjustsFontSizeToFit>
            {data ? money(data.total) : 'Rp –'}
          </Text>
        </View>

        {error && !data ? (
          <View style={styles.gap}>
            <Banner
              emoji="📡"
              tone="expense"
              text={error instanceof ApiError && error.offline ? "Can't reach the drawer. Check your connection." : 'The drawer jammed.'}
            />
            <Button variant="secondary" size="sm" label="Try again" onPress={reload} />
          </View>
        ) : null}

        {wallets.length > 0 ? (
          <View style={styles.card}>
            {wallets.map((w, i) => (
              <View key={w.id} style={[styles.row, i < wallets.length - 1 && styles.divider]}>
                <View style={styles.tile}>
                  <Text style={styles.tileEmoji}>{asEmoji(w.icon) ?? walletEmoji(w.name, w.wallet_type)}</Text>
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {w.name}
                  </Text>
                  <Text style={styles.rowType}>{typeLabel(w.wallet_type)}</Text>
                </View>
                <Text style={[styles.rowBalance, w.balance < 0 && { color: Colors.expense }]}>{money(w.balance)}</Text>
              </View>
            ))}
          </View>
        ) : data ? (
          <Text style={styles.hint}>No wallets yet. Add the places your money lives: cash, bank, e-wallet.</Text>
        ) : null}

        {adding ? (
          <View style={styles.form}>
            <Text style={styles.formTitle}>New wallet</Text>
            <Input label="Name" value={name} onChangeText={setName} placeholder="BCA, GoPay, Cash…" autoFocus returnKeyType="next" />
            <View style={styles.gapSm}>
              <Text style={styles.label}>Type</Text>
              <View style={styles.types}>
                {TYPES.map((t) => (
                  <Chip key={t.value} label={t.label} emoji={t.emoji} active={type === t.value} onPress={() => setType(t.value)} />
                ))}
              </View>
            </View>
            <Input
              label="What's in it now"
              value={groupDigits(opening)}
              onChangeText={(t) => setOpening(t.replace(/\D/g, '').slice(0, 13))}
              placeholder="0"
              keyboardType="number-pad"
              hint="Optional. Counted as the starting balance, not as income."
              error={formError ?? undefined}
            />
            <View style={styles.formButtons}>
              <Button variant="ghost" label="Cancel" onPress={closeForm} style={styles.flex} />
              <Button label="Into the drawer" onPress={save} loading={saving} style={styles.flex} />
            </View>
          </View>
        ) : (
          <Button variant="secondary" label="Add a wallet" emoji="➕" onPress={() => setAdding(true)} full />
        )}
      </Screen>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  gap: { gap: 8 },
  gapSm: { gap: 6 },
  title: { fontSize: 26, fontWeight: '800', color: Colors.charcoal, letterSpacing: -0.5 },
  totalCard: { padding: 18, gap: 2, borderRadius: 18, backgroundColor: Colors.cream },
  totalLabel: { fontSize: 13, fontWeight: '600', color: Colors.secondaryGray },
  total: { fontSize: 28, fontWeight: '800', color: Colors.charcoal, letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  card: {
    paddingHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.white,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.borderLight },
  tile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.cream },
  tileEmoji: { fontSize: 19 },
  rowText: { flex: 1, gap: 2 },
  rowName: { fontSize: 15, fontWeight: '700', color: Colors.charcoal },
  rowType: { fontSize: 13, color: Colors.secondaryGray },
  rowBalance: { fontSize: 15, fontWeight: '700', color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  hint: { fontSize: 14, lineHeight: 20, color: Colors.secondaryGray },
  form: {
    gap: 14,
    padding: 16,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.white,
  },
  formTitle: { fontSize: 17, fontWeight: '800', color: Colors.charcoal },
  label: { fontSize: 13, fontWeight: '600', color: Colors.charcoal },
  types: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  formButtons: { flexDirection: 'row', gap: 10, marginTop: 4 },
})
