import React, { useCallback } from 'react'
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { router } from 'expo-router'
import { Icon, IconTile, type IconName } from '@/components/ui/Icon'
import { Mascot, Wordmark } from '@/components/Mascot'
import { TransactionRow } from '@/components/TransactionRow'
import { Button } from '@/components/ui/Button'
import { Screen } from '@/components/ui/Screen'
import { SectionTitle } from '@/components/ui/Section'
import { Banner, Skeleton } from '@/components/ui/States'
import { Endpoints } from '@/constants/api'
import { card, Fonts, ledge, makeStyles, useColors } from '@/constants/colors'
import { useScreenData } from '@/hooks/useScreenData'
import { ApiError, api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { dayLabel, localDate, longDate, money, moneyShort, monthLabel, thisMonth } from '@/lib/display'
import { walletIconName } from '@/lib/icons'
import type { BalanceReport, Insight, MonthlyRow, Transaction } from '@/types/api'

const RECENT = 6

interface HomeData {
  balances: BalanceReport
  month: MonthlyRow
  recent: Transaction[]
  insight: Insight | null
}

const QUICK: { key: string; label: string; icon: IconName; start: 'camera' | 'type' | 'pdf' }[] = [
  { key: 'scan', label: 'Scan receipt', icon: 'camera', start: 'camera' },
  { key: 'type', label: 'Type it', icon: 'edit', start: 'type' },
  { key: 'pdf', label: 'Invoice PDF', icon: 'document', start: 'pdf' },
]

/** A line about the month in DROIN's voice, from how much of what came in has gone out. */
function moodLine(total: number, month: MonthlyRow) {
  if (total < 0) return 'Running on fumes.'
  if (month.income === 0 && month.expense === 0) return 'A fresh, quiet month.'
  if (month.expense > month.income && month.income > 0) return 'Spending more than came in.'
  return 'Still got some.'
}

export default function Home() {
  const Colors = useColors()
  const styles = useStyles()
  const { user } = useAuth()

  const load = useCallback(async (): Promise<HomeData> => {
    const month = thisMonth()
    const [balances, months, recent, insights] = await Promise.all([
      api.get<BalanceReport>(Endpoints.reportBalances),
      api.get<MonthlyRow[]>(Endpoints.reportMonthly, { from: month, to: month }),
      api.get<Transaction[]>(Endpoints.transactions, { limit: RECENT }),
      api.get<{ insights: Insight[] }>(Endpoints.insights).catch(() => ({ insights: [] })),
    ])
    return {
      balances,
      month: months[0] ?? { month, income: 0, expense: 0, net: 0 },
      recent,
      insight: insights.insights[0] ?? null,
    }
  }, [])
  const { data, error, refreshing, refresh, reload } = useScreenData(load)

  const spentShare = data && data.month.income > 0 ? Math.min(data.month.expense / data.month.income, 1) : null
  const firstName = (user?.name ?? 'there').split(' ')[0]

  return (
    <Screen inTabs bottomSpace={28} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.orange} colors={[Colors.orange]} />}>
      <View style={styles.topBar}>
        <Wordmark width={92} />
        <Pressable
          onPress={() => router.navigate('/me')}
          accessibilityRole="button"
          accessibilityLabel="Your profile"
          hitSlop={8}
          style={({ pressed }) => [styles.avatar, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.avatarText}>{firstName.charAt(0).toUpperCase()}</Text>
        </Pressable>
      </View>

      <View style={styles.greeting}>
        <Text style={styles.date}>{longDate(localDate(0))}</Text>
        <Text style={styles.hello} numberOfLines={1}>
          Hi, {firstName}
        </Text>
      </View>

      {error && !data ? (
        <View style={styles.errorBox}>
          <Banner
            icon="offline"
            tone="expense"
            text={error instanceof ApiError && error.offline ? "Can't reach the drawer. Check your connection." : 'The drawer jammed. Pull down to try again.'}
          />
          <Button variant="secondary" size="sm" label="Try again" onPress={reload} />
        </View>
      ) : null}

      {/* Balance: the one number that matters, then this month's in/out. The mascot sits on top. */}
      <View style={styles.balanceWrap}>
        <View style={styles.peek} pointerEvents="none">
          <Mascot size={118} mood={data && data.balances.total < 0 ? 'sad' : 'happy'} flipToCoin />
        </View>
        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>{data ? moodLine(data.balances.total, data.month) : 'Counting the coins…'}</Text>
          {data ? (
            <Text style={[styles.balance, data.balances.total < 0 && { color: '#F2A68C' }]} numberOfLines={1} adjustsFontSizeToFit>
              {money(data.balances.total)}
            </Text>
          ) : (
            <View style={styles.balanceSkeleton}>
              <Skeleton width="62%" height={34} radius={10} dark />
            </View>
          )}

          <View style={styles.monthRow}>
            <MonthCell label={`In · ${data ? monthLabel(data.month.month) : '…'}`} value={data?.month.income} icon="in" tint="#9CCB9F" />
            <View style={styles.monthDivider} />
            <MonthCell label="Out" value={data?.month.expense} icon="out" tint="#F2A68C" />
          </View>

          {spentShare !== null ? (
            <View style={styles.meter} accessibilityLabel={`Spent ${Math.round(spentShare * 100)} percent of what came in this month`}>
              <View style={styles.meterTrack}>
                <View
                  style={[
                    styles.meterFill,
                    { width: `${Math.max(spentShare * 100, 3)}%`, backgroundColor: spentShare >= 0.9 ? '#F2A68C' : Colors.orange },
                  ]}
                />
              </View>
              <Text style={styles.meterText}>{Math.round(spentShare * 100)}% of what came in has gone out</Text>
            </View>
          ) : null}
        </View>
      </View>

      {/* One tap into the Add tab, already doing the thing. */}
      <View style={styles.quickRow}>
        {QUICK.map((q) => (
          <Pressable
            key={q.key}
            onPress={() => router.navigate({ pathname: '/add', params: { start: q.start, at: String(Date.now()) } })}
            accessibilityRole="button"
            accessibilityLabel={q.label}
            style={({ pressed }) => [styles.quick, pressed && styles.quickPressed]}
          >
            <View style={styles.quickIcon}>
              <Icon name={q.icon} size={20} color={Colors.onOrange} />
            </View>
            <Text style={styles.quickLabel} numberOfLines={1}>
              {q.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {data?.insight ? <Banner icon="lightbulb" text={data.insight.message} /> : null}

      {/* Wallets */}
      <View style={styles.section}>
        <SectionTitle title="Wallets" action="Manage" onAction={() => router.navigate('/wallets')} />
        {data && data.balances.wallets.length === 0 ? (
          <Pressable onPress={() => router.navigate('/wallets')} style={({ pressed }) => [styles.addWallet, pressed && { opacity: 0.7 }]}>
            <View style={styles.addWalletIcon}>
              <Icon name="add" size={20} color={Colors.orangeDeep} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.addWalletTitle}>Add your first wallet</Text>
              <Text style={styles.addWalletText}>Cash, BCA, GoPay… wherever your money lives.</Text>
            </View>
          </Pressable>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.walletRow} style={styles.walletScroll}>
            {data
              ? data.balances.wallets.map((w) => (
                  <Pressable
                    key={w.id}
                    onPress={() => router.navigate('/wallets')}
                    accessibilityRole="button"
                    accessibilityLabel={`${w.name}, ${money(w.balance)}`}
                    style={({ pressed }) => [styles.walletCard, pressed && { opacity: 0.75 }]}
                  >
                    <IconTile name={walletIconName(w)} size={38} bg={Colors.cream} color={Colors.charcoal} style={styles.walletTile} />
                    <Text style={styles.walletName} numberOfLines={1}>
                      {w.name}
                    </Text>
                    <Text style={[styles.walletBalance, w.balance < 0 && { color: Colors.expense }]} numberOfLines={1}>
                      {moneyShort(w.balance)}
                    </Text>
                  </Pressable>
                ))
              : [0, 1, 2].map((i) => (
                  <View key={i} style={styles.walletCard}>
                    <Skeleton width={36} height={36} radius={11} />
                    <Skeleton width={60} height={12} />
                    <Skeleton width={80} height={16} />
                  </View>
                ))}
          </ScrollView>
        )}
      </View>

      {/* Recent */}
      <View style={styles.section}>
        <SectionTitle title="Recent" action={data?.recent.length ? 'See all' : undefined} onAction={() => router.navigate('/history')} />
        {data && data.recent.length === 0 ? (
          <View style={styles.empty}>
            <Mascot size={92} mood="curious" />
            <Text style={styles.emptyTitle}>Nothing happened here. Suspicious.</Text>
            <Text style={styles.emptyText}>Snap a receipt or type “kopi 18rb” and it lands here.</Text>
            <Button label="Put something in" onPress={() => router.navigate('/add')} size="sm" />
          </View>
        ) : (
          <View style={styles.listCard}>
            {data
              ? data.recent.map((t, i, all) => (
                  <View key={t.id}>
                    {i === 0 || all[i - 1]!.transaction_date !== t.transaction_date ? (
                      <Text style={[styles.dayLabel, i > 0 && { marginTop: 10 }]}>{dayLabel(t.transaction_date)}</Text>
                    ) : null}
                    <TransactionRow tx={t} last={i === all.length - 1 || all[i + 1]!.transaction_date !== t.transaction_date} />
                  </View>
                ))
              : [0, 1, 2].map((i) => (
                  <View key={i} style={styles.skeletonRow}>
                    <Skeleton width={42} height={42} radius={13} />
                    <View style={styles.skeletonText}>
                      <Skeleton width="55%" height={13} />
                      <Skeleton width="35%" height={11} />
                    </View>
                    <Skeleton width={70} height={14} />
                  </View>
                ))}
          </View>
        )}
      </View>
    </Screen>
  )
}

function MonthCell({ label, value, icon, tint }: { label: string; value?: number; icon: IconName; tint: string }) {
  const styles = useStyles()
  return (
    <View style={styles.monthCell}>
      <View style={[styles.monthIcon, { backgroundColor: `${tint}33` }]}>
        <Icon name={icon} size={14} color={tint} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.monthCaption} numberOfLines={1}>
          {label}
        </Text>
        {value === undefined ? <Skeleton width={70} height={14} dark /> : <Text style={styles.monthValue} numberOfLines={1}>{money(value)}</Text>}
      </View>
    </View>
  )
}

const useStyles = makeStyles((Colors) => ({
  flex: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.orangeSoft,
    borderWidth: 1.5,
    borderColor: Colors.orangeBorder,
  },
  avatarText: { fontSize: 17, fontFamily: Fonts.black, color: Colors.orangeDeep },
  greeting: { gap: 1, marginTop: -4 },
  date: { fontSize: 13, fontFamily: Fonts.bold, color: Colors.secondaryGray },
  hello: { fontSize: 30, fontFamily: Fonts.black, color: Colors.charcoal, letterSpacing: -0.6 },
  errorBox: { gap: 8 },

  balanceWrap: { paddingTop: 42 },
  peek: { position: 'absolute', right: 10, top: 0, zIndex: 2 },
  balanceCard: {
    backgroundColor: Colors.inkCard,
    borderRadius: 24,
    padding: 20,
    paddingTop: 22,
    gap: 4,
    ...ledge(Colors.inkLedge, 4),
  },
  balanceLabel: { fontSize: 14, fontFamily: Fonts.bold, color: '#E4D0B6', paddingRight: 124 },
  balance: { fontSize: 38, fontFamily: Fonts.black, color: Colors.face, letterSpacing: -1, fontVariant: ['tabular-nums'], paddingRight: 64 },
  balanceSkeleton: { height: 46, justifyContent: 'center' },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(248,232,204,0.14)',
  },
  monthCell: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  monthIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  monthCaption: { fontSize: 12, fontFamily: Fonts.bold, color: '#E4D0B6' },
  monthValue: { fontSize: 15, fontFamily: Fonts.extrabold, color: Colors.face, fontVariant: ['tabular-nums'] },
  monthDivider: { width: 1, alignSelf: 'stretch', backgroundColor: 'rgba(248,232,204,0.14)', marginHorizontal: 12 },
  meter: { gap: 8, marginTop: 14 },
  meterTrack: { height: 8, borderRadius: 4, backgroundColor: 'rgba(248,232,204,0.14)', overflow: 'hidden' },
  meterFill: { height: 8, borderRadius: 4 },
  meterText: { fontSize: 12, fontFamily: Fonts.semibold, color: '#E4D0B6' },

  quickRow: { flexDirection: 'row', gap: 10 },
  quick: { flex: 1, alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 6, ...card(Colors), borderRadius: 18 },
  quickPressed: { backgroundColor: Colors.cream },
  quickIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.orange,
    borderWidth: 1.5,
    borderColor: Colors.ink,
    ...ledge(Colors.ink, 2),
  },
  quickLabel: { fontSize: 13, fontFamily: Fonts.extrabold, color: Colors.charcoal },

  section: { gap: 12 },
  walletScroll: { marginHorizontal: -20 },
  walletRow: { gap: 10, paddingHorizontal: 20, paddingBottom: 2 },
  walletCard: { width: 136, padding: 14, gap: 6, ...card(Colors), borderRadius: 18 },
  walletTile: { marginBottom: 2 },
  walletName: { fontSize: 13, fontFamily: Fonts.bold, color: Colors.secondaryGray },
  walletBalance: { fontSize: 17, fontFamily: Fonts.black, color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  addWallet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 18,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: Colors.border,
  },
  addWalletIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.orangeSoft },
  addWalletTitle: { fontSize: 15, fontFamily: Fonts.extrabold, color: Colors.charcoal },
  addWalletText: { fontSize: 13, fontFamily: Fonts.regular, color: Colors.secondaryGray },

  listCard: { paddingHorizontal: 16, paddingVertical: 10, ...card(Colors) },
  dayLabel: { fontSize: 12, fontFamily: Fonts.extrabold, color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 4 },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  skeletonText: { flex: 1, gap: 6 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 24, paddingHorizontal: 20, borderRadius: 22, backgroundColor: Colors.cream },
  emptyTitle: { fontSize: 17, fontFamily: Fonts.black, color: Colors.charcoal, textAlign: 'center' },
  emptyText: { fontSize: 14, fontFamily: Fonts.regular, color: Colors.secondaryGray, textAlign: 'center', marginBottom: 8 },
}))
