import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { TransactionRow } from '@/components/TransactionRow'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Input } from '@/components/ui/Input'
import { Screen } from '@/components/ui/Screen'
import { Banner } from '@/components/ui/States'
import { Endpoints } from '@/constants/api'
import { Colors } from '@/constants/colors'
import { ApiError, api } from '@/lib/api'
import { dayLabel, money } from '@/lib/display'
import type { Transaction, TransactionType } from '@/types/api'

const PAGE = 40
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
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('') // debounced search
  const [items, setItems] = useState<Transaction[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

  const days = byDay(items)
  const filtered = filter !== 'all' || query !== ''

  return (
    <Screen
      inTabs
      bottomSpace={24}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadFirst(true)} tintColor={Colors.orange} colors={[Colors.orange]} />}
    >
      <Text style={styles.title}>History</Text>

      <Input icon="search-outline" value={search} onChangeText={setSearch} placeholder="Search notes or categories" returnKeyType="search" autoCorrect={false} />
      <View style={styles.filters}>
        <Chip label="All" active={filter === 'all'} onPress={() => setFilter('all')} />
        <Chip label="Spent" active={filter === 'expense'} onPress={() => setFilter('expense')} />
        <Chip label="Got" active={filter === 'income'} onPress={() => setFilter('income')} />
      </View>

      {error ? <Banner emoji="📡" tone="expense" text={error} /> : null}

      {loading && items.length === 0 ? (
        <ActivityIndicator color={Colors.orange} style={styles.spinner} />
      ) : days.length === 0 ? (
        <View style={styles.empty}>
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

const styles = StyleSheet.create({
  title: { fontSize: 26, fontWeight: '800', color: Colors.charcoal, letterSpacing: -0.5 },
  filters: { flexDirection: 'row', gap: 8, marginTop: -4 },
  spinner: { marginTop: 32 },
  days: { gap: 16 },
  day: { gap: 8 },
  dayHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 2 },
  dayLabel: { fontSize: 12, fontWeight: '700', color: Colors.secondaryGray, textTransform: 'uppercase', letterSpacing: 0.6 },
  dayNet: { fontSize: 13, fontWeight: '700', color: Colors.secondaryGray, fontVariant: ['tabular-nums'] },
  card: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.white,
  },
  empty: { alignItems: 'center', gap: 6, paddingVertical: 28, paddingHorizontal: 16, borderRadius: 18, backgroundColor: Colors.cream },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.charcoal, textAlign: 'center' },
  emptyText: { fontSize: 14, color: Colors.secondaryGray, textAlign: 'center', marginBottom: 8 },
})
