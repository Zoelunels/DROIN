import React, { useCallback } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { Redirect, router } from 'expo-router'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Screen } from '@/components/ui/Screen'
import { Banner, EmptyState } from '@/components/ui/States'
import { Endpoints } from '@/constants/api'
import { card, Fonts, makeStyles, useColors } from '@/constants/colors'
import { useScreenData } from '@/hooks/useScreenData'
import { ApiError, api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { dayLabel, money } from '@/lib/display'
import type { SharedBill, Split } from '@/types/api'

const errorText = (err: unknown) =>
  err instanceof ApiError ? (err.offline ? "Can't reach the drawer. Check your connection." : err.message) : 'The drawer jammed. Try again?'

/**
 * Every bill you split, newest first, and who still owes you; plus bills friends paid and split with
 * you (by your @username), which you can mark paid from here.
 */
export default function Splits() {
  const Colors = useColors()
  const styles = useStyles()
  const { isAuthenticated, isLoading } = useAuth()
  const load = useCallback(async () => {
    const [mine, shared] = await Promise.all([api.get<Split[]>(Endpoints.splits), api.get<SharedBill[]>(Endpoints.splitsShared)])
    return { mine, shared }
  }, [])
  const { data, error, refreshing, refresh, reload } = useScreenData(load)

  if (!isLoading && !isAuthenticated) return <Redirect href="/login" />

  const mine = data?.mine ?? []
  const owed = mine.reduce((sum, s) => sum + s.owed_to_me, 0)
  const open = mine.filter((s) => !s.settled)
  const done = mine.filter((s) => s.settled)
  const shared = data?.shared ?? []
  const iOwe = shared.reduce((sum, b) => sum + b.remaining, 0)

  return (
    <Screen
      bottomSpace={32}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.orange} colors={[Colors.orange]} />}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" style={styles.headerButton}>
          <Icon name="back" size={24} color={Colors.charcoal} />
        </Pressable>
        <Text style={styles.headerTitle}>Split bills</Text>
        <View style={styles.headerButton} />
      </View>

      {error && !data ? (
        <View style={styles.gap}>
          <Banner icon="offline" tone="expense" text={errorText(error)} />
          <Button variant="secondary" label="Try again" onPress={reload} />
        </View>
      ) : !data ? (
        <ActivityIndicator color={Colors.orange} style={styles.spinner} />
      ) : mine.length === 0 && shared.length === 0 ? (
        <EmptyState
          title="No splits yet."
          subtitle="Scan a receipt, then pick Save as: Split bill to share it with friends. Bills friends split with you show up here too."
          actionLabel="Scan a receipt"
          onAction={() => router.navigate({ pathname: '/add', params: { start: 'camera', at: String(Date.now()) } })}
        />
      ) : (
        <>
          {mine.length > 0 ? (
            <View style={styles.summary}>
              <Text style={styles.summaryLabel}>Friends owe you</Text>
              <Text style={styles.summaryValue}>{money(owed)}</Text>
              <Text style={styles.summaryHint}>{open.length === 0 ? 'All paid back. Nice.' : `${open.length} ${open.length === 1 ? 'bill' : 'bills'} still open`}</Text>
            </View>
          ) : null}
          {shared.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>Shared with you{iOwe > 0 ? ` · you owe ${money(iOwe)}` : ''}</Text>
              <SharedList bills={shared} />
            </>
          ) : null}
          {open.length > 0 ? (
            <>
              {shared.length > 0 ? <Text style={styles.sectionLabel}>You paid</Text> : null}
              <SplitList splits={open} />
            </>
          ) : null}
          {done.length > 0 ? (
            <>
              <Text style={styles.sectionLabel}>Settled</Text>
              <SplitList splits={done} />
            </>
          ) : null}
        </>
      )}
    </Screen>
  )
}

/** Bills someone else paid with you on them. */
function SharedList({ bills }: { bills: SharedBill[] }) {
  const Colors = useColors()
  const styles = useStyles()
  return (
    <View style={styles.card}>
      {bills.map((b, i) => {
        const owes = b.status === 'owes'
        const payer = b.owner.username ? `@${b.owner.username}` : b.owner.name
        return (
          <Pressable
            key={b.id}
            onPress={() => router.push({ pathname: '/splits/shared/[id]', params: { id: String(b.id) } })}
            accessibilityRole="button"
            style={({ pressed }) => [styles.row, i < bills.length - 1 && styles.divider, { opacity: pressed ? 0.55 : 1 }]}
          >
            <View style={[styles.rowIcon, owes ? { backgroundColor: Colors.expenseSoft } : { backgroundColor: Colors.incomeSoft }]}>
              <Icon name={owes ? 'receipt' : 'check'} size={20} color={owes ? Colors.expense : Colors.income} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {b.title}
              </Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {dayLabel(b.split_date)} · {payer} paid{owes ? ', you owe them' : b.status === 'settled' ? ', you paid back' : ''}
              </Text>
            </View>
            <View style={styles.rowRight}>
              <Text style={[styles.rowAmount, owes && { color: Colors.expense }]}>{money(owes ? b.remaining : b.share)}</Text>
              <Text style={styles.rowAmountHint}>{owes ? 'you owe' : 'your share'}</Text>
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

function SplitList({ splits }: { splits: Split[] }) {
  const Colors = useColors()
  const styles = useStyles()
  return (
    <View style={styles.card}>
      {splits.map((s, i) => {
        const owing = s.people.filter((p) => p.status === 'owes')
        return (
          <Pressable
            key={s.id}
            onPress={() => router.push({ pathname: '/splits/[id]', params: { id: String(s.id) } })}
            accessibilityRole="button"
            style={({ pressed }) => [styles.row, i < splits.length - 1 && styles.divider, { opacity: pressed ? 0.55 : 1 }]}
          >
            <View style={[styles.rowIcon, s.settled && { backgroundColor: Colors.incomeSoft }]}>
              <Icon name={s.settled ? 'check' : 'people'} size={20} color={s.settled ? Colors.income : Colors.orangeDeep} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {s.title}
              </Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {dayLabel(s.split_date)} · {s.settled ? 'everyone paid' : `${owing.map((p) => p.name).join(', ')} ${owing.length === 1 ? 'owes' : 'owe'} you`}
              </Text>
            </View>
            <View style={styles.rowRight}>
              <Text style={[styles.rowAmount, !s.settled && { color: Colors.income }]}>{money(s.settled ? s.total : s.owed_to_me)}</Text>
              <Text style={styles.rowAmountHint}>{s.settled ? 'total' : 'owed'}</Text>
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

const useStyles = makeStyles((Colors) => ({
  gap: { gap: 8 },
  spinner: { marginTop: 32 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontFamily: Fonts.extrabold, color: Colors.charcoal },
  summary: { gap: 2, padding: 18, borderRadius: 22, backgroundColor: Colors.inkCard, borderWidth: 2, borderColor: Colors.inkLedge, borderBottomWidth: 5 },
  summaryLabel: { fontSize: 13, fontFamily: Fonts.extrabold, color: Colors.face, opacity: 0.85 },
  summaryValue: { fontSize: 30, fontFamily: Fonts.black, color: Colors.face, fontVariant: ['tabular-nums'] },
  summaryHint: { fontSize: 13, fontFamily: Fonts.semibold, color: Colors.face, opacity: 0.75 },
  sectionLabel: { fontSize: 12, fontFamily: Fonts.extrabold, color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 4 },
  card: { paddingHorizontal: 16, ...card(Colors) },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.borderLight },
  rowIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.orangeSoft },
  rowText: { flex: 1, gap: 1 },
  rowTitle: { fontSize: 15, fontFamily: Fonts.extrabold, color: Colors.charcoal },
  rowSub: { fontSize: 13, fontFamily: Fonts.regular, color: Colors.secondaryGray },
  rowRight: { alignItems: 'flex-end' },
  rowAmount: { fontSize: 15, fontFamily: Fonts.black, color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  rowAmountHint: { fontSize: 11, fontFamily: Fonts.bold, color: Colors.muted },
}))
