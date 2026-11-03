import React, { useCallback, useState } from 'react'
import { KeyboardAvoidingView, Platform, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Input } from '@/components/ui/Input'
import { Screen } from '@/components/ui/Screen'
import { Banner, EmptyState, Skeleton } from '@/components/ui/States'
import { PageTitle } from '@/components/ui/Section'
import { Mascot } from '@/components/Mascot'
import { Endpoints } from '@/constants/api'
import { card, Fonts, ledge, makeStyles, useColors } from '@/constants/colors'
import { useScreenData } from '@/hooks/useScreenData'
import { ApiError, api } from '@/lib/api'
import { groupDigits, money } from '@/lib/display'
import { WALLET_TYPE_ICON, walletIconName } from '@/lib/icons'
import { IconTile } from '@/components/ui/Icon'
import { notify } from '@/lib/toast'
import type { BalanceReport, WalletType } from '@/types/api'

const TYPES: { value: WalletType; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'bank', label: 'Bank' },
  { value: 'ewallet', label: 'E-wallet' },
  { value: 'savings', label: 'Savings' },
  { value: 'other', label: 'Other' },
]
const typeLabel = (t: WalletType) => TYPES.find((x) => x.value === t)?.label ?? 'Other'

export default function Wallets() {
  const Colors = useColors()
  const styles = useStyles()
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
        <PageTitle eyebrow={wallets.length ? `${wallets.length} ${wallets.length === 1 ? 'place' : 'places'} your money lives` : 'Where your money lives'} title="Wallets" />

        <View style={styles.totalCard}>
          <View style={styles.flex}>
            <Text style={styles.totalLabel}>All wallets together</Text>
            {data ? (
              <Text style={[styles.total, data.total < 0 && { color: '#5E1404' }]} numberOfLines={1} adjustsFontSizeToFit>
                {money(data.total)}
              </Text>
            ) : (
              <View style={styles.totalSkeleton}>
                <Skeleton width="70%" height={28} radius={9} />
              </View>
            )}
          </View>
          <Mascot size={70} mood="happy" />
        </View>

        {error && !data ? (
          <View style={styles.gap}>
            <Banner
              icon="offline"
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
                <IconTile name={walletIconName(w)} bg={Colors.cream} color={Colors.charcoal} />
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
          <EmptyState compact mood="curious" title="No wallets yet." subtitle="Add the places your money lives: cash, a bank account, GoPay…" />
        ) : null}

        {adding ? (
          <View style={styles.form}>
            <Text style={styles.formTitle}>New wallet</Text>
            <Input label="Name" value={name} onChangeText={setName} placeholder="BCA, GoPay, Cash…" autoFocus returnKeyType="next" />
            <View style={styles.gapSm}>
              <Text style={styles.label}>Type</Text>
              <View style={styles.types}>
                {TYPES.map((t) => (
                  <Chip key={t.value} label={t.label} icon={WALLET_TYPE_ICON[t.value]} active={type === t.value} onPress={() => setType(t.value)} />
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
          <Button label="Add a wallet" onPress={() => setAdding(true)} full />
        )}
      </Screen>
    </KeyboardAvoidingView>
  )
}

const useStyles = makeStyles((Colors) => ({
  fill: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  gap: { gap: 8 },
  gapSm: { gap: 6 },
  totalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 18,
    paddingRight: 14,
    borderRadius: 22,
    backgroundColor: Colors.orange,
    borderWidth: 2,
    borderColor: Colors.ink,
    ...ledge(Colors.ink, 4),
  },
  totalLabel: { fontSize: 13, fontFamily: Fonts.extrabold, color: '#46362B' },
  total: { fontSize: 30, fontFamily: Fonts.black, color: Colors.ink, letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  totalSkeleton: { height: 40, justifyContent: 'center' },
  card: { paddingHorizontal: 16, ...card(Colors) },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  rowText: { flex: 1, gap: 1 },
  rowName: { fontSize: 16, fontFamily: Fonts.extrabold, color: Colors.charcoal },
  rowType: { fontFamily: Fonts.semibold, fontSize: 13, color: Colors.secondaryGray },
  rowBalance: { fontSize: 16, fontFamily: Fonts.black, color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  form: { gap: 14, padding: 16, ...card(Colors) },
  formTitle: { fontSize: 18, fontFamily: Fonts.black, color: Colors.charcoal },
  label: { fontSize: 13, fontFamily: Fonts.bold, color: Colors.charcoal },
  types: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  formButtons: { flexDirection: 'row', gap: 10, marginTop: 4, alignItems: 'flex-end' },
}))
