import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, Text, View } from 'react-native'
import { Icon } from '@/components/ui/Icon'
import { router, useFocusEffect } from 'expo-router'
import { TransactionRow } from '@/components/TransactionRow'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Screen } from '@/components/ui/Screen'
import { Banner, Skeleton } from '@/components/ui/States'
import { PageTitle } from '@/components/ui/Section'
import { Mascot } from '@/components/Mascot'
import { Endpoints } from '@/constants/api'
import { card, Fonts, makeStyles, useColors, type Palette } from '@/constants/colors'
import { ApiError, api } from '@/lib/api'
import { dayLabel, money } from '@/lib/display'
import { exportToExcel } from '@/lib/exportExcel'
import { notify } from '@/lib/toast'
import type { Transaction, TransactionType } from '@/types/api'

const PAGE = 40
const FILTERS: { value: Filter; label: string; color: keyof Palette }[] = [
  { value: 'all', label: 'All', color: 'charcoal' },
  { value: 'income', label: 'In', color: 'income' },
  { value: 'expense', label: 'Out', color: 'expense' },
]
type Filter = 'all' | TransactionType

/** Groups a date-sorted list into days, with each day's net (income − expense). */
function byDay(list: Transaction[]) {
  const days: { date: string; net: number; items: Transaction[] }[] = []
  for (const t of list) {
    let day = days[days.length - 1]
    if (!day || day.date !== t.transaction_date) {
      day = { date: t.transaction_date, net: 0, items: [] }
      days.push(day)
    }
    day.items.push(t)
    day.net += t.type === 'income' ? t.amount : -t.amount
  }
  return days
}

export default function History() {
  const Colors = useColors()
  const styles = useStyles()
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('') // debounced search
  const [items, setItems] = useState<Transaction[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const request = useRef(0) // ignores answers to older requests when filters change quickly

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const fetchPage = useCallback(
    (offset: number) =>
      api.get<Transaction[]>(Endpoints.transactions, {
        limit: PAGE,
        offset,
        type: filter === 'all' ? undefined : filter,
        q: query || undefined,
      }),
    [filter, query],
  )

  const loadFirst = useCallback(
    async (pulled = false) => {
      const id = ++request.current
      if (pulled) setRefreshing(true)
      else setLoading(true)
      try {
        const page = await fetchPage(0)
        if (id !== request.current) return
        setItems(page)
        setHasMore(page.length === PAGE)
        setError(null)
      } catch (err) {
        if (id !== request.current) return
        setError(err instanceof ApiError && err.offline ? "Can't reach the drawer. Check your connection." : 'The drawer jammed. Pull down to try again.')
      } finally {
        if (id === request.current) {
          setLoading(false)
          setRefreshing(false)
        }
      }
    },
    [fetchPage],
  )

  // Reload when the tab opens (new entries) and whenever the filter or search changes.
  useFocusEffect(
    useCallback(() => {
      loadFirst()
    }, [loadFirst]),
  )

  async function loadMore() {
    setLoadingMore(true)
    try {
      const page = await fetchPage(items.length)
      setItems((prev) => [...prev, ...page])
      setHasMore(page.length === PAGE)
    } catch {
      setError("Couldn't load more. Try again.")
    } finally {
      setLoadingMore(false)
    }
  }

  // Exports what the list shows: same In/Out filter and search, every page (not just the loaded 40).
  async function onExport() {
    setExporting(true)
    try {
      await exportToExcel({ type: filter === 'all' ? undefined : filter, q: query })
    } catch (err) {
      notify.error(err instanceof ApiError ? (err.offline ? "Can't reach the drawer." : err.message) : "Couldn't make the Excel file.", undefined, 'document')
    } finally {
      setExporting(false)
    }
  }

  const days = byDay(items)
  const filtered = filter !== 'all' || query !== ''

  return (
    <Screen
      inTabs
      bottomSpace={24}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadFirst(true)} tintColor={Colors.orange} colors={[Colors.orange]} />}
    >
      <PageTitle
        eyebrow={items.length ? (hasMore ? 'Newest first' : `${items.length} ${items.length === 1 ? 'entry' : 'entries'}`) : 'Everything you put in'}
        title="History"
        right={
        <Pressable
          onPress={onExport}
          disabled={exporting || items.length === 0}
          accessibilityRole="button"
          accessibilityLabel="Export to Excel"
          accessibilityHint="Exports the entries shown, with the current filter and search"
          hitSlop={8}
          style={({ pressed }) => [styles.export, { opacity: exporting || items.length === 0 ? 0.45 : pressed ? 0.6 : 1 }]}
        >
          {exporting ? <ActivityIndicator size="small" color={Colors.income} /> : <Icon name="download" size={18} color={Colors.income} />}
          <Text style={styles.exportText}>Excel</Text>
        </Pressable>
        }
      />

      <Input icon="search" value={search} onChangeText={setSearch} placeholder="Search notes or categories" returnKeyType="search" autoCorrect={false} />
      <View style={styles.segment} accessibilityRole="radiogroup">
        {FILTERS.map((f) => {
          const on = filter === f.value
          return (
            <Pressable
              key={f.value}
              onPress={() => setFilter(f.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={[styles.segmentItem, on && styles.segmentOn]}
            >
              <Text style={[styles.segmentText, on && { color: Colors[f.color] }]}>{f.label}</Text>
            </Pressable>
          )
        })}
      </View>

      {error ? <Banner icon="offline" tone="expense" text={error} /> : null}

      {loading && items.length === 0 ? (
        <View style={styles.card}>
          {[0, 1, 2, 3].map((i) => (
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
      ) : days.length === 0 ? (
        <View style={styles.empty}>
          <Mascot size={92} mood={filtered ? 'curious' : 'sleepy'} />
          <Text style={styles.emptyTitle}>{filtered ? 'Nothing matches that.' : 'Nothing happened here. Suspicious.'}</Text>
          <Text style={styles.emptyText}>{filtered ? 'Try another word or filter.' : 'Everything you put in shows up here, newest first.'}</Text>
          {!filtered ? <Button label="Put something in" size="sm" onPress={() => router.navigate('/add')} /> : null}
        </View>
      ) : (
        <View style={styles.days}>
          {days.map((day) => (
            <View key={day.date} style={styles.day}>
              <View style={styles.dayHead}>
                <Text style={styles.dayLabel}>{dayLabel(day.date)}</Text>
                <Text style={[styles.dayNet, day.net > 0 && { color: Colors.income }]}>{money(day.net, { sign: true })}</Text>
              </View>
              <View style={styles.card}>
                {day.items.map((t, i) => (
                  <TransactionRow key={t.id} tx={t} last={i === day.items.length - 1} />
                ))}
              </View>
            </View>
          ))}
          {hasMore ? <Button variant="secondary" label="Load more" onPress={loadMore} loading={loadingMore} full /> : null}
        </View>
      )}
    </Screen>
  )
}

const useStyles = makeStyles((Colors) => ({
  export: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.incomeBorder,
    backgroundColor: Colors.incomeSoft,
  },
  exportText: { fontSize: 14, fontFamily: Fonts.extrabold, color: Colors.income },
  segment: { flexDirection: 'row', padding: 4, borderRadius: 14, backgroundColor: Colors.cream, marginTop: -4 },
  segmentItem: { flex: 1, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: Colors.surface, borderWidth: 1.5, borderColor: Colors.borderLight, borderBottomWidth: 3 },
  segmentText: { fontSize: 14, fontFamily: Fonts.extrabold, color: Colors.secondaryGray },
  days: { gap: 18 },
  day: { gap: 8 },
  dayHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 4 },
  dayLabel: { fontSize: 12, fontFamily: Fonts.extrabold, color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8 },
  dayNet: { fontSize: 13, fontFamily: Fonts.extrabold, color: Colors.secondaryGray, fontVariant: ['tabular-nums'] },
  card: { paddingHorizontal: 16, paddingVertical: 4, ...card(Colors) },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  skeletonText: { flex: 1, gap: 6 },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 28, paddingHorizontal: 20, borderRadius: 22, backgroundColor: Colors.cream },
  emptyTitle: { fontSize: 17, fontFamily: Fonts.black, color: Colors.charcoal, textAlign: 'center' },
  emptyText: { fontFamily: Fonts.regular, fontSize: 14, color: Colors.secondaryGray, textAlign: 'center', marginBottom: 8 },
}))
