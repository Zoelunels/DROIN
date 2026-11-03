import React, { useCallback, useState } from 'react'
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native'
import { Redirect, router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { Icon, IconTile } from '@/components/ui/Icon'
import { DraftCard, draftAmount, draftProblem, fromTransaction, type EditableDraft } from '@/components/voice/DraftCard'
import { Button } from '@/components/ui/Button'
import { Screen } from '@/components/ui/Screen'
import { Banner } from '@/components/ui/States'
import { ReceiptSection } from '@/components/ReceiptSection'
import { TYPE_LABEL, typeColor } from '@/components/ui/TypeToggle'
import { Endpoints } from '@/constants/api'
import { Fonts, makeStyles, useColors } from '@/constants/colors'
import { ApiError, api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { dayLabel, money } from '@/lib/display'
import { transactionIconName } from '@/lib/icons'
import { notify } from '@/lib/toast'
import type { Category, Transaction, Wallet } from '@/types/api'

const errorText = (err: unknown) =>
  err instanceof ApiError ? (err.offline ? "Can't reach the drawer. Check your connection." : err.message) : 'The drawer jammed. Try again?'

/** Ask before something irreversible. Alert has no buttons on web, so the browser's confirm is used there. */
function confirm(title: string, message: string, action: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(globalThis.confirm?.(`${title}\n\n${message}`) ?? false)
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Keep it', style: 'cancel', onPress: () => resolve(false) },
      { text: action, style: 'destructive', onPress: () => resolve(true) },
    ]),
  )
}

/** One entry: tap a row in Home or History to get here. Normal entries can be edited and deleted. */
export default function TransactionDetail() {
  const Colors = useColors()
  const styles = useStyles()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { isAuthenticated, isLoading } = useAuth()
  const [tx, setTx] = useState<Transaction | null>(null)
  const [draft, setDraft] = useState<EditableDraft | null>(null)
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [systemCategoryIds, setSystemCategoryIds] = useState<number[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const [t, w, c] = await Promise.all([
        api.get<Transaction>(`${Endpoints.transactions}/${id}`),
        api.get<Wallet[]>(Endpoints.wallets),
        api.get<Category[]>(Endpoints.categories),
      ])
      setTx(t)
      setDraft(fromTransaction(t))
      setWallets(w)
      setCategories(c.filter((x) => !x.system_key))
      setSystemCategoryIds(c.filter((x) => x.system_key).map((x) => x.id))
    } catch (err) {
      setLoadError(err instanceof ApiError && err.status === 404 ? 'This entry is gone. Maybe it was deleted.' : errorText(err))
    }
  }, [id])

  // Tab screens stay alive in the background: reload every time the entry is opened, so it is
  // never an older copy (another entry, or this one from before it was edited).
  useFocusEffect(
    useCallback(() => {
      load()
    }, [load]),
  )

  if (!isLoading && !isAuthenticated) return <Redirect href="/login" />

  // Opening balances (system category), transfers and debt payments belong to something else;
  // only plain entries are editable here.
  const editable = tx?.origin === 'manual' && tx.category_id !== null && !systemCategoryIds.includes(tx.category_id)
  const changed =
    !!tx &&
    !!draft &&
    (draftAmount(draft) !== Math.round(tx.amount) ||
      draft.type !== tx.type ||
      draft.categoryId !== tx.category_id ||
      draft.walletId !== tx.wallet_id ||
      draft.date !== tx.transaction_date ||
      draft.note.trim() !== (tx.note ?? ''))

  async function save() {
    if (!draft || !tx) return
    const problem = draftProblem(draft)
    if (problem) {
      notify.info(problem, undefined, 'edit')
      return
    }
    setSaving(true)
    try {
      await api.put(`${Endpoints.transactions}/${tx.id}`, {
        wallet_id: draft.walletId,
        category_id: draft.categoryId,
        type: draft.type,
        amount: draftAmount(draft),
        transaction_date: draft.date,
        note: draft.note.trim() || null,
      })
      notify.success('Changes tucked in.', undefined, 'archive')
      router.back()
    } catch (err) {
      notify.error(errorText(err))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!tx) return
    const ok = await confirm('Delete this entry?', `${tx.note || tx.category_name || 'Entry'} · ${money(tx.amount)}. This can't be undone.`, 'Delete')
    if (!ok) return
    setDeleting(true)
    try {
      await api.delete(`${Endpoints.transactions}/${tx.id}`)
      notify.success('Taken out of the drawer.', undefined, 'trash')
      router.back()
    } catch (err) {
      notify.error(errorText(err))
      setDeleting(false)
    }
  }

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen inTabs bottomSpace={32}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" style={styles.headerButton}>
            <Icon name="back" size={24} color={Colors.charcoal} />
          </Pressable>
          <Text style={styles.headerTitle}>{editable ? 'Edit entry' : 'Entry'}</Text>
          {tx && editable ? (
            <Pressable onPress={remove} hitSlop={12} accessibilityRole="button" accessibilityLabel="Delete entry" style={styles.headerButton}>
              {deleting ? <ActivityIndicator color={Colors.expense} /> : <Icon name="trash" size={22} color={Colors.expense} />}
            </Pressable>
          ) : (
            <View style={styles.headerButton} />
          )}
        </View>

        {loadError ? (
          <View style={styles.gap}>
            <Banner icon="offline" tone="expense" text={loadError} />
            <Button variant="secondary" label="Try again" onPress={load} />
          </View>
        ) : !tx || !draft || String(tx.id) !== id ? (
          <ActivityIndicator color={Colors.orange} style={styles.spinner} />
        ) : (
          <>
            {/* Summary, only for entries that can't be edited: an editable entry's form already shows
                every detail, so it starts right under the header instead of below a repeat of them. */}
            {!editable ? (
              <View style={styles.summary}>
                <IconTile name={transactionIconName(tx)} size={56} bg={Colors.cream} color={Colors.charcoal} />
                <Text style={[styles.summaryAmount, { color: tx.type === 'income' ? Colors.income : Colors.charcoal }]}>
                  {money(tx.type === 'income' ? tx.amount : -tx.amount, { sign: true })}
                </Text>
                <Text style={styles.summaryMeta}>
                  <Text style={{ color: typeColor(Colors, tx.type), fontFamily: Fonts.bold }}>{TYPE_LABEL[tx.type]}</Text>
                  {' · '}
                  {[tx.category_name, tx.wallet_name, dayLabel(tx.transaction_date)].filter(Boolean).join(' · ')}
                </Text>
                {tx.note ? <Text style={styles.summaryNote}>“{tx.note}”</Text> : null}
                {tx.tags.length > 0 ? <Text style={styles.summaryMeta}>{tx.tags.map((g) => `#${g.name}`).join('  ')}</Text> : null}
              </View>
            ) : null}

            {editable ? (
              <>
                <DraftCard
                  draft={draft}
                  wallets={wallets}
                  categories={categories}
                  onChange={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
                  onCreateWallet={() => router.navigate('/wallets')}
                  onCategoryCreated={(c) => setCategories((prev) => [...prev, c])}
                />
                <Button label={changed ? 'Save changes' : 'No changes yet'} onPress={save} loading={saving} disabled={!changed} size="lg" full />
                <ReceiptSection transactionId={tx.id} confirm={confirm} />
              </>
            ) : (
              <Banner
                icon="lock"
                text={
                  tx.origin === 'manual'
                    ? "This is a wallet's starting balance, set when the wallet was added, so it can't be edited here."
                    : 'This entry comes from a transfer or a debt, so it changes together with that, not here.'
                }
              />
            )}
          </>
        )}
      </Screen>
    </KeyboardAvoidingView>
  )
}

const useStyles = makeStyles((Colors) => ({
  fill: { flex: 1, backgroundColor: Colors.background },
  gap: { gap: 8 },
  spinner: { marginTop: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontFamily: Fonts.extrabold, color: Colors.charcoal },
  summary: { alignItems: 'center', gap: 6, paddingVertical: 8 },
  summaryAmount: { fontSize: 32, fontFamily: Fonts.extrabold, letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  summaryMeta: { fontFamily: Fonts.regular, fontSize: 14, color: Colors.secondaryGray, textAlign: 'center' },
  summaryNote: { fontFamily: Fonts.regular, fontSize: 15, fontStyle: 'italic', color: Colors.charcoal, textAlign: 'center' },
}))
