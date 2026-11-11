import React, { useCallback, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
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
import type { Split, SplitPerson } from '@/types/api'

const errorText = (err: unknown) =>
  err instanceof ApiError ? (err.offline ? "Can't reach the drawer. Check your connection." : err.message) : 'The drawer jammed. Try again?'

/** One split bill: everyone's share, who paid you back, and what each person had. */
export default function SplitDetail() {
  const Colors = useColors()
  const styles = useStyles()
  const { isAuthenticated, isLoading } = useAuth()
  const { id } = useLocalSearchParams<{ id: string }>()
  const load = useCallback(() => api.get<Split>(`${Endpoints.splits}/${id}`), [id])
  const { data: split, error, refreshing, refresh, reload } = useScreenData(load)
  const [paying, setPaying] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  if (!isLoading && !isAuthenticated) return <Redirect href="/login" />

  async function markPaid(person: SplitPerson) {
    if (!split) return
    setPaying(person.id)
    try {
      await api.post<Split>(`${Endpoints.splits}/${split.id}/people/${person.id}/paid`)
      reload()
      notify.success(`${person.name} paid you back.`, `${money(person.remaining)} back in ${split.wallet_name}.`, 'check-circle')
    } catch (err) {
      notify.error(errorText(err))
    } finally {
      setPaying(null)
    }
  }

  async function remove() {
    if (!split) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setDeleting(true)
    try {
      await api.delete(`${Endpoints.splits}/${split.id}`)
      notify.info('Split deleted.', 'Your share, what they owed and any paybacks are undone.', 'trash')
      router.back()
    } catch (err) {
      notify.error(errorText(err))
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const nameOf = (position: number) => {
    const p = split?.people.find((x) => x.position === position)
    return p ? (p.is_me ? 'You' : p.name) : '?'
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
        <Text style={styles.headerTitle}>Split bill</Text>
        <View style={styles.headerButton} />
      </View>

      {error && !split ? (
        <View style={styles.gap}>
          <Banner icon="offline" tone="expense" text={errorText(error)} />
          <Button variant="secondary" label="Try again" onPress={reload} />
        </View>
      ) : !split ? (
        <ActivityIndicator color={Colors.orange} style={styles.spinner} />
      ) : (
        <>
          <View style={styles.hero}>
            <Text style={styles.heroTitle} numberOfLines={2}>
              {split.title}
            </Text>
            <Text style={styles.heroSub}>
              {longDate(split.split_date)} · paid {money(split.total)} from {split.wallet_name}
            </Text>
            <View style={[styles.badge, split.settled ? styles.badgeDone : styles.badgeOpen]}>
              <Text style={[styles.badgeText, { color: split.settled ? Colors.income : Colors.orangeDeep }]}>
                {split.settled ? 'Everyone paid you back' : `${money(split.owed_to_me)} still owed to you`}
              </Text>
            </View>
          </View>

          <View style={styles.card}>
            {split.people.map((p, i) => {
              const look = personLook(Colors, p.position, p.is_me)
              return (
                <View key={p.id} style={[styles.person, i < split.people.length - 1 && styles.divider]}>
                  <View style={[styles.dot, { backgroundColor: look.bg, borderColor: look.border }]}>
                    <Text style={[styles.dotText, { color: look.fg }]}>{p.is_me ? 'Me' : initialOf(p.name)}</Text>
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.personName} numberOfLines={1}>
                      {p.is_me ? 'You' : p.name}
                    </Text>
                    <Text style={styles.personHint}>
                      {p.status === 'me'
                        ? 'Your share, in your spending'
                        : p.status === 'settled'
                          ? 'Paid you back'
                          : p.status === 'removed'
                            ? 'Their debt was deleted'
                            : p.remaining < p.share
                              ? `Paid part, ${money(p.remaining)} left`
                              : 'Owes you'}
                    </Text>
                  </View>
                  <View style={styles.personRight}>
                    <Text style={[styles.share, p.status === 'settled' && styles.shareDone]}>{money(p.share)}</Text>
                    {p.status === 'owes' ? (
                      <Button size="sm" variant="soft" label="Paid back" onPress={() => markPaid(p)} loading={paying === p.id} disabled={paying !== null} />
                    ) : p.status === 'settled' ? (
                      <Icon name="check-circle" size={18} color={Colors.income} />
                    ) : null}
                  </View>
                </View>
              )
            })}
          </View>

          {split.items.length > 0 ? (
            <View style={styles.card}>
              <Text style={styles.sectionLabel}>Who had what</Text>
              {split.items.map((item, i) => (
                <View key={i} style={[styles.item, i < split.items.length - 1 && styles.divider]}>
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

          <Text style={styles.footnote}>
            Paid back puts their share back into {split.wallet_name}.
          </Text>

          <Button
            variant={confirmDelete ? 'danger' : 'ghost'}
            icon="trash"
            label={confirmDelete ? 'Tap again to delete the split' : 'Delete this split'}
            onPress={remove}
            loading={deleting}
            full
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
  badgeOpen: { backgroundColor: Colors.orangeSoft, borderColor: Colors.orangeBorder },
  badgeDone: { backgroundColor: Colors.incomeSoft, borderColor: Colors.incomeBorder },
  badgeText: { fontSize: 13, fontFamily: Fonts.extrabold },
  card: { paddingHorizontal: 16, paddingVertical: 4, ...card(Colors) },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.borderLight },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  dot: { width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  dotText: { fontSize: 13, fontFamily: Fonts.black },
  personName: { fontSize: 16, fontFamily: Fonts.extrabold, color: Colors.charcoal },
  personHint: { fontSize: 13, fontFamily: Fonts.regular, color: Colors.secondaryGray },
  personRight: { alignItems: 'flex-end', gap: 6 },
  share: { fontSize: 16, fontFamily: Fonts.black, color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  shareDone: { color: Colors.income },
  sectionLabel: { paddingTop: 12, paddingBottom: 4, fontSize: 12, fontFamily: Fonts.extrabold, color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  itemName: { fontSize: 15, fontFamily: Fonts.bold, color: Colors.charcoal },
  itemWho: { fontSize: 13, fontFamily: Fonts.regular, color: Colors.secondaryGray },
  itemAmount: { fontSize: 15, fontFamily: Fonts.extrabold, color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  footnote: { fontSize: 13, lineHeight: 18, fontFamily: Fonts.regular, color: Colors.secondaryGray },
}))
