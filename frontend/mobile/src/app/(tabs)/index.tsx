import React, { useCallback } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { router } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import { Mascot } from '@/components/Mascot'
import { TransactionRow } from '@/components/TransactionRow'
import { Button } from '@/components/ui/Button'
import { Screen } from '@/components/ui/Screen'
import { Banner } from '@/components/ui/States'
import { Endpoints } from '@/constants/api'
import { Colors } from '@/constants/colors'
import { useScreenData } from '@/hooks/useScreenData'
import { ApiError, api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { asEmoji, dayLabel, localDate, longDate, money, moneyShort, monthLabel, thisMonth } from '@/lib/display'
import { walletEmoji } from '@/lib/emoji'
import type { BalanceReport, Insight, MonthlyRow, Transaction } from '@/types/api'

const RECENT = 6

interface HomeData {
  balances: BalanceReport
  month: MonthlyRow
  recent: Transaction[]
  insight: Insight | null
}

function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={styles.sectionHead}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button">
          {({ pressed }) => <Text style={[styles.sectionAction, pressed && { opacity: 0.5 }]}>{action}</Text>}
        </Pressable>
      ) : null}
    </View>
  )
}

export default function Home() {
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


  return (
    <Screen inTabs bottomSpace={24} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.orange} colors={[Colors.orange]} />}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.date}>{longDate(localDate(0))}</Text>
          <Text style={styles.hello} numberOfLines={1}>
            Hi, {user?.name ?? 'there'}
          </Text>
        </View>
        <Mascot size={52} mood="happy" sparkle={false} />
      </View>

      {error && !data ? (
        <View style={styles.errorBox}>
          <Banner
            emoji="📡"
            tone="expense"
            text={error instanceof ApiError && error.offline ? "Can't reach the drawer. Check your connection." : 'The drawer jammed. Pull down to try again.'}
          />
          <Button variant="secondary" size="sm" label="Try again" onPress={reload} />
        </View>
      ) : null}

      {/* Balance: the one number that matters, then this month's in/out. */}
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Still got some.</Text>
        <Text style={styles.balance} numberOfLines={1} adjustsFontSizeToFit>
          {data ? money(data.balances.total) : 'Rp –'}
        </Text>
        <View style={styles.monthRow}>
          <View style={styles.monthCell}>
            <View style={[styles.monthIcon, { backgroundColor: 'rgba(111,143,114,0.25)' }]}>
              <Ionicons name="arrow-down" size={14} color="#A9C7AB" />
            </View>
            <View>
              <Text style={styles.monthCaption}>In · {data ? monthLabel(data.month.month) : '…'}</Text>
              <Text style={styles.monthValue}>{data ? money(data.month.income) : '–'}</Text>
            </View>
          </View>
          <View style={styles.monthDivider} />
          <View style={styles.monthCell}>
            <View style={[styles.monthIcon, { backgroundColor: 'rgba(201,106,74,0.25)' }]}>
              <Ionicons name="arrow-up" size={14} color="#E9A58C" />
            </View>
            <View>
              <Text style={styles.monthCaption}>Out</Text>
              <Text style={styles.monthValue}>{data ? money(data.month.expense) : '–'}</Text>
            </View>
          </View>
        </View>
      </View>

      {data?.insight ? <Banner emoji="💡" text={data.insight.message} /> : null}

      {/* Wallets */}
      <View style={styles.section}>
        <SectionTitle title="Wallets" action="Manage" onAction={() => router.navigate('/wallets')} />
        {data && data.balances.wallets.length === 0 ? (
          <Pressable onPress={() => router.navigate('/wallets')} style={({ pressed }) => [styles.addWallet, pressed && { opacity: 0.7 }]}>
            <Ionicons name="add-circle-outline" size={20} color={Colors.orange} />
            <Text style={styles.addWalletText}>Add your first wallet (cash, BCA, GoPay…)</Text>
          </Pressable>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.walletRow} style={styles.walletScroll}>
            {(data?.balances.wallets ?? []).map((w) => (
              <View key={w.id} style={styles.walletCard}>
                <Text style={styles.walletEmoji}>{asEmoji(w.icon) ?? walletEmoji(w.name, w.wallet_type)}</Text>
                <Text style={styles.walletName} numberOfLines={1}>
                  {w.name}
                </Text>
                <Text style={[styles.walletBalance, w.balance < 0 && { color: Colors.expense }]} numberOfLines={1}>
                  {moneyShort(w.balance)}
                </Text>
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
            <Text style={styles.emptyTitle}>Nothing happened here. Suspicious.</Text>
            <Text style={styles.emptyText}>Your first entry will show up here.</Text>
            <Button label="Put something in" onPress={() => router.navigate('/add')} size="sm" />
          </View>
        ) : (
          <View style={styles.listCard}>
            {(data?.recent ?? []).map((t, i, all) => (
              <View key={t.id}>
                {i === 0 || all[i - 1]!.transaction_date !== t.transaction_date ? (
                  <Text style={[styles.dayLabel, i > 0 && { marginTop: 8 }]}>{dayLabel(t.transaction_date)}</Text>
                ) : null}
                <TransactionRow tx={t} last={i === all.length - 1 || all[i + 1]!.transaction_date !== t.transaction_date} />
              </View>
            ))}
          </View>
        )}
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  headerText: { flex: 1, gap: 2 },
  date: { fontSize: 13, fontWeight: '600', color: Colors.secondaryGray },
  hello: { fontSize: 26, fontWeight: '800', color: Colors.charcoal, letterSpacing: -0.5 },
  errorBox: { gap: 8 },
  balanceCard: { backgroundColor: Colors.charcoal, borderRadius: 20, padding: 20, gap: 4 },
  balanceLabel: { fontSize: 14, fontWeight: '600', color: '#BDB6AA' },
  balance: { fontSize: 34, fontWeight: '800', color: Colors.white, letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.18)',
  },
  monthCell: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  monthIcon: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  monthCaption: { fontSize: 12, fontWeight: '600', color: '#BDB6AA' },
  monthValue: { fontSize: 15, fontWeight: '700', color: Colors.white, fontVariant: ['tabular-nums'] },
  monthDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: 'rgba(255,255,255,0.18)', marginHorizontal: 12 },
  section: { gap: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: Colors.charcoal },
  sectionAction: { fontSize: 14, fontWeight: '700', color: '#C9853A' },
  walletScroll: { marginHorizontal: -20 },
  walletRow: { gap: 10, paddingHorizontal: 20 },
  walletCard: {
    width: 128,
    padding: 14,
    gap: 4,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.white,
  },
  walletEmoji: { fontSize: 20, marginBottom: 4 },
  walletName: { fontSize: 13, fontWeight: '600', color: Colors.secondaryGray },
  walletBalance: { fontSize: 16, fontWeight: '800', color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  addWallet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 16,
    borderRadius: 16,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.borderLight,
  },
  addWalletText: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.charcoal },
  listCard: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.white,
  },
  dayLabel: { fontSize: 12, fontWeight: '700', color: Colors.secondaryGray, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 4 },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 24, paddingHorizontal: 16, borderRadius: 18, backgroundColor: Colors.cream },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.charcoal, textAlign: 'center' },
  emptyText: { fontSize: 14, color: Colors.secondaryGray, textAlign: 'center', marginBottom: 8 },
})
