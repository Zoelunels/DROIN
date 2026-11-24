import React, { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Switch, Text, View } from 'react-native'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { CategoryPicker } from '@/components/CategoryPicker'
import { personLook } from '@/components/SplitBill'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Screen } from '@/components/ui/Screen'
import { Banner } from '@/components/ui/States'
import { Endpoints } from '@/constants/api'
import { card, Fonts, makeStyles, useColors } from '@/constants/colors'
import { useScreenData } from '@/hooks/useScreenData'
import { ApiError, api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { longDate, money } from '@/lib/display'
import { initialOf } from '@/lib/split'
import { notify } from '@/lib/toast'
import type { Category, SharedBillDetail, Wallet } from '@/types/api'

const errorText = (err: unknown) =>
  err instanceof ApiError ? (err.offline ? "Can't reach the drawer. Check your connection." : err.message) : 'The drawer jammed. Try again?'

/**
 * A bill a friend paid and split with you. Shows what you had and your share; "I paid them back"
 * settles it on their side too, and can record your share as your own spending.
 */
export default function SharedBillScreen() {
  const Colors = useColors()
  const styles = useStyles()
  const { isAuthenticated, isLoading } = useAuth()
  const { id } = useLocalSearchParams<{ id: string }>()
  const load = useCallback(async () => {
    const [bill, wallets, categories] = await Promise.all([
      api.get<SharedBillDetail>(`${Endpoints.splitsShared}/${id}`),
      api.get<Wallet[]>(Endpoints.wallets),
      api.get<Category[]>(Endpoints.categories),
    ])
    return { bill, wallets: wallets.filter((w) => !w.archived_at), categories }
  }, [id])
  const { data, error, refreshing, refresh, reload } = useScreenData(load)
  const [record, setRecord] = useState(true)
  const [walletId, setWalletId] = useState<number | null>(null)
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [extraCategories, setExtraCategories] = useState<Category[]>([])
  const [picking, setPicking] = useState(false)
  const [paying, setPaying] = useState(false)

  if (!isLoading && !isAuthenticated) return <Redirect href="/login" />

  const bill = data?.bill
  const expenseCategories = [...(data?.categories ?? []), ...extraCategories].filter((c) => c.type === 'expense' && !c.archived_at && !c.system_key)
  // Defaults: your first wallet, and Food & Drinks (most split bills are meals).
  const wallet = data?.wallets.find((w) => w.id === walletId) ?? data?.wallets[0] ?? null
  const category =
    expenseCategories.find((c) => c.id === categoryId) ?? expenseCategories.find((c) => /food/i.test(c.name)) ?? expenseCategories[0] ?? null
  const payer = bill ? (bill.owner.username ? `@${bill.owner.username}` : bill.owner.name) : ''
  const canRecord = record && wallet !== null && category !== null

  async function pay() {
    if (!bill) return
    setPaying(true)
    try {
      await api.post<SharedBillDetail>(
        `${Endpoints.splitsShared}/${bill.id}/paid`,
        canRecord ? { wallet_id: wallet!.id, category_id: category!.id } : {},
      )
      reload()
      notify.success(
        `Marked paid to ${bill.owner.name}.`,
        canRecord ? `${money(bill.remaining)} spent from ${wallet!.name}.` : 'They see it as paid back.',
        'check-circle',
      )
    } catch (err) {
      notify.error(errorText(err))
    } finally {
      setPaying(false)
    }
  }

  const nameOf = (position: number) => {
    const p = bill?.people.find((x) => x.position === position)
    return p ? (p.position === bill?.position ? 'You' : p.name) : '?'
  }

  return (
    <Screen
      bottomSpace={32}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.orange} colors={[Colors.orange]} />}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" style={styles.headerButton}>
          <Icon name="back" size={24} color={Colors.charcoal} />
        </Pressable>
        <Text style={styles.headerTitle}>Shared with you</Text>
        <View style={styles.headerButton} />
      </View>

      {error && !data ? (
        <View style={styles.gap}>
          <Banner icon="offline" tone="expense" text={errorText(error)} />
          <Button variant="secondary" label="Try again" onPress={reload} />
        </View>
      ) : !bill || !data ? (
        <ActivityIndicator color={Colors.orange} style={styles.spinner} />
      ) : (
        <>
          <View style={styles.hero}>
            <Text style={styles.heroTitle} numberOfLines={2}>
              {bill.title}
            </Text>
            <Text style={styles.heroSub}>
              {longDate(bill.split_date)} · {payer} paid {money(bill.total)}
            </Text>
            <View style={[styles.badge, bill.status === 'owes' ? styles.badgeOpen : styles.badgeDone]}>
              <Text style={[styles.badgeText, { color: bill.status === 'owes' ? Colors.expense : Colors.income }]}>
                {bill.status === 'owes'
                  ? `You owe ${bill.owner.name} ${money(bill.remaining)}`
                  : bill.status === 'settled'
                    ? 'You paid them back'
                    : `${bill.owner.name} took you off this bill`}
              </Text>
            </View>
          </View>

          <View style={styles.card}>
            {bill.people.map((p, i) => {
              const you = p.position === bill.position
              const look = personLook(Colors, p.position, p.is_payer)
              return (
                <View key={p.position} style={[styles.person, i < bill.people.length - 1 && styles.divider]}>
                  <View style={[styles.dot, { backgroundColor: look.bg, borderColor: look.border }]}>
                    <Text style={[styles.dotText, { color: look.fg }]}>{initialOf(p.name)}</Text>
                  </View>
                  <View style={styles.flex}>
                    <Text style={[styles.personName, you && { color: Colors.orangeDeep }]} numberOfLines={1}>
                      {you ? 'You' : p.name}
                    </Text>
                    <Text style={styles.personHint} numberOfLines={1}>
                      {p.is_payer ? 'Paid the bill' : you ? 'Your share' : p.username ? `@${p.username}` : 'Their share'}
                    </Text>
                  </View>
                  <Text style={[styles.share, you && { color: bill.status === 'owes' ? Colors.expense : Colors.income }]}>{money(p.share)}</Text>
                </View>
              )
            })}
          </View>

          {bill.items.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.sectionLabel}>Who had what</Text>
              {bill.items.map((item, i) => (
                <View key={i} style={[styles.item, i < bill.items.length - 1 && styles.divider]}>
                  <View style={styles.flex}>
                    <Text style={styles.itemName} numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text style={styles.itemWho} numberOfLines={2}>
                      {item.people.map(nameOf).join(', ')}
                    </Text>
                  </View>
                  <Text style={styles.itemAmount}>{money(item.amount)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {bill.status === 'owes' ? (
            <View style={styles.payCard}>
              <Text style={styles.payTitle}>Paid {bill.owner.name} back?</Text>
              <View style={styles.recordRow}>
                <View style={styles.flex}>
                  <Text style={styles.recordTitle}>Add to my spending</Text>
                  <Text style={styles.recordHint}>{record ? 'Your share as an expense in DROIN.' : 'Only mark it paid (already recorded it).'}</Text>
                </View>
                <Switch
                  value={record}
                  onValueChange={setRecord}
                  trackColor={{ true: Colors.orange, false: Colors.border }}
                  thumbColor={Colors.onColor}
                  accessibilityLabel="Add to my spending"
                />
              </View>

              {record ? (
                data.wallets.length === 0 ? (
                  <Text style={styles.recordHint}>Add a wallet first to record it, or turn this off.</Text>
                ) : (
                  <>
                    <Text style={styles.fieldLabel}>Paid from</Text>
                    <View style={styles.chips}>
                      {data.wallets.map((w) => {
                        const on = w.id === wallet?.id
                        return (
                          <Pressable
                            key={w.id}
                            onPress={() => setWalletId(w.id)}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: on }}
                            style={[styles.chip, on && styles.chipOn]}
                          >
                            <Text style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>
                              {w.name}
                            </Text>
                          </Pressable>
                        )
                      })}
                    </View>
                    <Text style={styles.fieldLabel}>Category</Text>
                    <Pressable onPress={() => setPicking(true)} accessibilityRole="button" style={styles.categoryButton}>
                      <Text style={styles.categoryText} numberOfLines={1}>
                        {category?.name ?? 'Pick a category'}
                      </Text>
                      <Icon name="chevron-down" size={18} color={Colors.secondaryGray} />
                    </Pressable>
                  </>
                )
              ) : null}

              <Button
                label={`I paid ${money(bill.remaining)}`}
                icon="check"
                onPress={pay}
                loading={paying}
                disabled={paying || (record && !canRecord)}
                full
                size="lg"
              />
              <Text style={styles.footnote}>{bill.owner.name} sees it as paid back in their app.</Text>
            </View>
          ) : null}

          <CategoryPicker
            visible={picking}
            type="expense"
            categories={expenseCategories}
            selectedId={category?.id ?? null}
            onSelect={(c) => {
              setCategoryId(c.id)
              setPicking(false)
            }}
            onCreated={(c) => {
              setExtraCategories((list) => [...list, c])
              setCategoryId(c.id)
              setPicking(false)
            }}
            onClose={() => setPicking(false)}
          />
        </>
      )}
    </Screen>
  )
}

const useStyles = makeStyles((Colors) => ({
  gap: { gap: 8 },
  flex: { flex: 1 },
  spinner: { marginTop: 32 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontFamily: Fonts.extrabold, color: Colors.charcoal },
  hero: { gap: 6, padding: 18, ...card(Colors) },
  heroTitle: { fontSize: 22, fontFamily: Fonts.black, color: Colors.charcoal },
  heroSub: { fontSize: 14, fontFamily: Fonts.semibold, color: Colors.secondaryGray },
  badge: { alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, borderWidth: 1.5 },
  badgeOpen: { backgroundColor: Colors.expenseSoft, borderColor: Colors.expenseBorder },
  badgeDone: { backgroundColor: Colors.incomeSoft, borderColor: Colors.incomeBorder },
  badgeText: { fontSize: 13, fontFamily: Fonts.extrabold },
  card: { paddingHorizontal: 16, paddingVertical: 4, ...card(Colors) },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.borderLight },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  dot: { width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  dotText: { fontSize: 13, fontFamily: Fonts.black },
  personName: { fontSize: 16, fontFamily: Fonts.extrabold, color: Colors.charcoal },
  personHint: { fontSize: 13, fontFamily: Fonts.regular, color: Colors.secondaryGray },
  share: { fontSize: 16, fontFamily: Fonts.black, color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  sectionLabel: { paddingTop: 12, paddingBottom: 4, fontSize: 12, fontFamily: Fonts.extrabold, color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  itemName: { fontSize: 15, fontFamily: Fonts.bold, color: Colors.charcoal },
  itemWho: { fontSize: 13, fontFamily: Fonts.regular, color: Colors.secondaryGray },
  itemAmount: { fontSize: 15, fontFamily: Fonts.extrabold, color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  payCard: { gap: 12, padding: 16, ...card(Colors) },
  payTitle: { fontSize: 17, fontFamily: Fonts.black, color: Colors.charcoal },
  recordRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  recordTitle: { fontSize: 15, fontFamily: Fonts.extrabold, color: Colors.charcoal },
  recordHint: { fontSize: 13, fontFamily: Fonts.semibold, color: Colors.secondaryGray },
  fieldLabel: { fontSize: 12, fontFamily: Fonts.extrabold, color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { maxWidth: 160, height: 36, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12, borderWidth: 1.5, borderColor: Colors.borderLight, backgroundColor: Colors.surface },
  chipOn: { backgroundColor: Colors.orange, borderColor: Colors.ink },
  chipText: { fontSize: 14, fontFamily: Fonts.bold, color: Colors.charcoal },
  chipTextOn: { fontFamily: Fonts.black, color: Colors.onOrange },
  categoryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 48,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  categoryText: { flex: 1, fontSize: 15, fontFamily: Fonts.bold, color: Colors.charcoal },
  footnote: { fontSize: 13, lineHeight: 18, fontFamily: Fonts.regular, color: Colors.secondaryGray, textAlign: 'center' },
}))
