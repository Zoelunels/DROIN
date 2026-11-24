import React, { useEffect, useMemo, useState } from 'react'
import { Pressable, Switch, Text, View } from 'react-native'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Input } from '@/components/ui/Input'
import { Endpoints } from '@/constants/api'
import { card, Fonts, makeStyles, useColors, type Palette } from '@/constants/colors'
import { api } from '@/lib/api'
import { money } from '@/lib/display'
import { computeShares, initialOf, newPersonKey, type BillPerson, type BillState } from '@/lib/split'
import { cleanUsername } from '@/lib/username'
import type { EditableItem } from '@/components/ReceiptBreakdown'
import type { Friend, UserMatch } from '@/types/api'

/** Each person's colour: you in orange, everyone else from a small set that works in light and dark. */
export function personLook(Colors: Palette, index: number, me?: boolean) {
  if (me) return { bg: Colors.orange, fg: Colors.onOrange, border: Colors.ink }
  const looks = [
    { bg: Colors.incomeSoft, fg: Colors.income, border: Colors.incomeBorder },
    { bg: Colors.expenseSoft, fg: Colors.expense, border: Colors.expenseBorder },
    { bg: Colors.orangeSoft, fg: Colors.orangeDeep, border: Colors.orangeBorder },
    { bg: Colors.cream, fg: Colors.inkSoft, border: Colors.border },
  ]
  return looks[(index - 1) % looks.length]!
}

/**
 * Split the scanned bill: add friends (saved), friends on DROIN by @username (they see the bill in
 * their app), or guests (just a name), then tap each person's circle on what they had. Shares update as you go: items split between whoever had them, tax and service
 * spread in proportion.
 */
export function SplitBill({
  items,
  total,
  bill,
  onChange,
  onFixItems,
}: {
  /** The lines to split (the receipt's items, or the whole bill as one line). */
  items: EditableItem[]
  /** What was paid in total: the entry's amount. */
  total: number
  bill: BillState
  onChange: (bill: BillState) => void
  /** Go back to the item list to fix a misread name or amount. */
  onFixItems?: () => void
}) {
  const Colors = useColors()
  const styles = useStyles()
  const [friends, setFriends] = useState<Friend[]>([])
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [save, setSave] = useState(true)

  useEffect(() => {
    api.get<Friend[]>(Endpoints.friends).then(setFriends).catch(() => {})
  }, [])

  // Typing "@bu" looks up DROIN accounts. Results are kept with the text they answer, so a slow
  // reply for an older text never shows up under a newer one.
  const mention = name.trim().startsWith('@') ? cleanUsername(name) : null
  const [found, setFound] = useState<{ q: string; users: UserMatch[]; failed?: boolean }>({ q: '', users: [] })
  useEffect(() => {
    if (mention === null || mention.length < 2) return
    let live = true
    const timer = setTimeout(() => {
      api
        .get<UserMatch[]>(`${Endpoints.users}?search=${encodeURIComponent(mention)}`)
        .then((users) => live && setFound({ q: mention, users }))
        .catch(() => live && setFound({ q: mention, users: [], failed: true }))
    }, 250)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [mention])

  const shares = useMemo(() => computeShares(total, items, bill), [total, items, bill])
  const itemsSum = items.reduce((s, i) => s + (Number(i.amountText) || 0), 0)
  const extra = total - itemsSum
  const lookOf = (key: string) => {
    const index = bill.people.findIndex((p) => p.key === key)
    return personLook(Colors, index, bill.people[index]?.me)
  }

  const taken = new Set(bill.people.map((p) => p.name.trim().toLowerCase()))
  const takenUsers = new Set(bill.people.map((p) => p.username).filter(Boolean))
  const query = name.trim().toLowerCase()
  const suggestions =
    mention !== null
      ? []
      : friends
          .filter((f) => !taken.has(f.name.toLowerCase()) && !(f.username && takenUsers.has(f.username)) && (!query || f.name.toLowerCase().includes(query)))
          .slice(0, 8)
  const matches = mention !== null && found.q === mention ? found.users.filter((u) => !takenUsers.has(u.username)) : []
  const searching = mention !== null && mention.length >= 2 && found.q !== mention
  const exists = mention !== null ? takenUsers.has(mention) : query !== '' && taken.has(query)
  const mentionHint =
    mention === null
      ? undefined
      : mention.length < 2
        ? 'Keep typing their username'
        : searching
          ? 'Looking…'
          : found.failed
            ? "Can't search right now"
            : matches.length === 0 && !exists
              ? `No one on DROIN is @${mention}`
              : undefined

  function addPerson(person: Omit<BillPerson, 'key'>) {
    onChange({ ...bill, people: [...bill.people, { ...person, key: newPersonKey() }] })
    setName('')
    setAdding(false)
  }

  function addUser(u: UserMatch) {
    const friend = friends.find((f) => f.username === u.username)
    addPerson({ name: friend?.name ?? u.name, friendId: friend?.id ?? null, username: u.username, save: false })
  }

  function addTyped() {
    if (mention !== null) {
      const exact = matches.find((u) => u.username === mention)
      if (exact) addUser(exact)
      return
    }
    const clean = name.trim().slice(0, 60)
    if (!clean || exists) return
    const friend = friends.find((f) => f.name.toLowerCase() === clean.toLowerCase())
    addPerson(friend ? { name: friend.name, friendId: friend.id, username: friend.username, save: false } : { name: clean, friendId: null, save })
  }

  function removePerson(key: string) {
    const assign = Object.fromEntries(Object.entries(bill.assign).map(([item, who]) => [item, who.filter((k) => k !== key)]))
    onChange({ people: bill.people.filter((p) => p.key !== key), assign })
  }

  function toggle(itemKey: string, personKey: string) {
    const who = bill.assign[itemKey] ?? []
    const next = who.includes(personKey) ? who.filter((k) => k !== personKey) : [...who, personKey]
    onChange({ ...bill, assign: { ...bill.assign, [itemKey]: next } })
  }

  const everyone = () => onChange({ ...bill, assign: Object.fromEntries(items.map((i) => [i.key, bill.people.map((p) => p.key)])) })

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>Split the bill</Text>
        <Text style={styles.sub}>Add who was there, then tap their circle on what they had.</Text>
      </View>

      {/* People */}
      <View style={styles.people}>
        {bill.people.map((p, i) => {
          const look = personLook(Colors, i, p.me)
          return (
            <View key={p.key} style={[styles.person, { backgroundColor: look.bg, borderColor: look.border }]}>
              <Text style={[styles.personName, { color: look.fg }]} numberOfLines={1}>
                {p.me ? 'You' : p.name}
              </Text>
              {!p.me && p.username ? (
                <Text style={[styles.guest, { color: look.fg }]} numberOfLines={1}>
                  @{p.username}
                </Text>
              ) : !p.me && !p.friendId && !p.save ? (
                <Text style={[styles.guest, { color: look.fg }]}>guest</Text>
              ) : null}
              {!p.me ? (
                <Pressable
                  onPress={() => removePerson(p.key)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${p.name} from the split`}
                  style={styles.personRemove}
                >
                  <Icon name="close" size={13} color={look.fg} strokeWidth={2.6} />
                </Pressable>
              ) : null}
            </View>
          )
        })}
        {!adding && bill.people.length < 20 ? (
          <Pressable onPress={() => setAdding(true)} accessibilityRole="button" style={({ pressed }) => [styles.addPerson, pressed && { opacity: 0.6 }]}>
            <Icon name="add" size={15} color={Colors.orangeDeep} strokeWidth={2.6} />
            <Text style={styles.addPersonText}>Add person</Text>
          </Pressable>
        ) : null}
      </View>

      {adding ? (
        <View style={styles.addPanel}>
          <Input
            value={name}
            onChangeText={setName}
            placeholder="Name, or @username"
            autoFocus
            autoCapitalize={mention !== null ? 'none' : 'words'}
            autoCorrect={mention === null}
            returnKeyType="done"
            onSubmitEditing={addTyped}
            error={exists ? 'Already in this split' : undefined}
            hint={exists ? undefined : (mentionHint ?? (name === '' ? "Type @ to find a friend on DROIN: they'll see the bill too." : undefined))}
          />
          {matches.length > 0 ? (
            <View style={styles.suggestions}>
              {matches.map((u) => (
                <Pressable
                  key={u.username}
                  onPress={() => addUser(u)}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${u.name}, @${u.username}`}
                  style={({ pressed }) => [styles.suggestion, pressed && { backgroundColor: Colors.orangeSoft }]}
                >
                  <Icon name="user" size={13} color={Colors.inkSoft} />
                  <Text style={styles.suggestionText} numberOfLines={1}>
                    {u.name}
                  </Text>
                  <Text style={styles.suggestionHandle} numberOfLines={1}>
                    @{u.username}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {suggestions.length > 0 ? (
            <View style={styles.suggestions}>
              {suggestions.map((f) => (
                <Pressable
                  key={f.id}
                  onPress={() => addPerson({ name: f.name, friendId: f.id, username: f.username, save: false })}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${f.name}`}
                  style={({ pressed }) => [styles.suggestion, pressed && { backgroundColor: Colors.orangeSoft }]}
                >
                  <Icon name="user" size={13} color={Colors.inkSoft} />
                  <Text style={styles.suggestionText}>{f.name}</Text>
                  {f.username ? <Text style={styles.suggestionHandle}>@{f.username}</Text> : null}
                </Pressable>
              ))}
            </View>
          ) : null}
          {mention === null ? (
          <View style={styles.saveRow}>
            <View style={styles.flex}>
              <Text style={styles.saveTitle}>Save to friends</Text>
              <Text style={styles.saveHint}>{save ? 'Pick them faster next time.' : 'Guest: just a name on this bill.'}</Text>
            </View>
            <Switch
              value={save}
              onValueChange={setSave}
              trackColor={{ true: Colors.orange, false: Colors.border }}
              thumbColor={Colors.onColor}
              accessibilityLabel="Save to friends"
            />
          </View>
          ) : null}
          <View style={styles.addButtons}>
            <Button variant="ghost" size="sm" label="Cancel" onPress={() => { setAdding(false); setName('') }} />
            <Button size="sm" label="Add" onPress={addTyped} disabled={mention !== null ? !matches.some((u) => u.username === mention) : !name.trim() || exists} />
          </View>
        </View>
      ) : null}

      {/* Who had what */}
      <View style={styles.itemsHead}>
        <Text style={styles.sectionLabel}>Who had what</Text>
        {bill.people.length > 1 ? (
          <Pressable onPress={everyone} hitSlop={6} accessibilityRole="button">
            <Text style={styles.link}>Everyone shares all</Text>
          </Pressable>
        ) : null}
      </View>
      {items.map((item) => {
        const who = bill.assign[item.key] ?? []
        return (
          <View key={item.key} style={styles.item}>
            <View style={styles.itemTop}>
              <Text style={styles.itemName} numberOfLines={1}>
                {item.name || 'Item'}
              </Text>
              <Text style={styles.itemAmount}>{money(Number(item.amountText) || 0)}</Text>
            </View>
            <View style={styles.circles}>
              {bill.people.map((p, i) => {
                const on = who.includes(p.key)
                const look = personLook(Colors, i, p.me)
                return (
                  <Pressable
                    key={p.key}
                    onPress={() => toggle(item.key, p.key)}
                    hitSlop={4}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={`${p.me ? 'You' : p.name} had ${item.name || 'this item'}`}
                    style={[
                      styles.circle,
                      { backgroundColor: on ? look.bg : 'transparent', borderColor: on ? look.fg : Colors.borderLight, opacity: on ? 1 : 0.7 },
                    ]}
                  >
                    <Text style={[styles.circleText, { color: on ? look.fg : Colors.muted }]}>{p.me ? 'Me' : initialOf(p.name)}</Text>
                  </Pressable>
                )
              })}
              {who.length === 0 ? <Text style={styles.nobody}>Who had this?</Text> : who.length > 1 ? <Text style={styles.splitN}>÷ {who.length}</Text> : null}
            </View>
          </View>
        )
      })}
      {onFixItems && items.some((i) => i.key !== 'whole') ? (
        <Pressable onPress={onFixItems} hitSlop={6} accessibilityRole="button" style={styles.fix}>
          <Icon name="edit" size={14} color={Colors.orangeDeep} />
          <Text style={styles.link}>Fix an item name or price</Text>
        </Pressable>
      ) : null}

      {extra !== 0 && itemsSum > 0 ? (
        <View style={styles.extra}>
          <Icon name="info" size={14} color={Colors.secondaryGray} />
          <Text style={styles.extraText}>
            {extra > 0 ? `Tax & service ${money(extra)}` : `Discount ${money(-extra)}`}, shared in proportion to what each person had.
          </Text>
        </View>
      ) : null}

      {/* The result */}
      <View style={styles.shares}>
        {bill.people.map((p) => {
          const look = lookOf(p.key)
          return (
            <View key={p.key} style={styles.shareRow}>
              <View style={[styles.dot, { backgroundColor: look.bg, borderColor: look.border }]}>
                <Text style={[styles.dotText, { color: look.fg }]}>{p.me ? 'Me' : initialOf(p.name)}</Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.shareName} numberOfLines={1}>
                  {p.me ? 'You' : p.name}
                </Text>
                <Text style={styles.shareHint}>{p.me ? 'Your expense' : p.username ? 'Owes you · sees it in their app' : 'Owes you'}</Text>
              </View>
              <Text style={[styles.shareAmount, !p.me && { color: Colors.income }]}>{money(shares[p.key] ?? 0)}</Text>
            </View>
          )
        })}
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>You pay now</Text>
          <Text style={styles.totalValue}>{money(total)}</Text>
        </View>
      </View>
      <Text style={styles.footnote}>
        The whole bill comes out of the wallet above. Only your share counts as spending; the rest shows in Split bills until they pay you back.
      </Text>
    </View>
  )
}

const useStyles = makeStyles((Colors) => ({
  card: { gap: 12, padding: 16, ...card(Colors) },
  flex: { flex: 1 },
  head: { gap: 2 },
  title: { fontSize: 17, fontFamily: Fonts.black, color: Colors.charcoal },
  sub: { fontSize: 13, fontFamily: Fonts.regular, color: Colors.secondaryGray },
  people: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingLeft: 12, paddingRight: 10, borderRadius: 17, borderWidth: 1.5 },
  personName: { maxWidth: 120, fontSize: 14, fontFamily: Fonts.extrabold },
  guest: { maxWidth: 90, fontSize: 11, fontFamily: Fonts.bold, opacity: 0.8 },
  personRemove: { width: 18, height: 18, alignItems: 'center', justifyContent: 'center' },
  addPerson: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: 17,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.orangeBorder,
  },
  addPersonText: { fontSize: 14, fontFamily: Fonts.extrabold, color: Colors.orangeDeep },
  addPanel: { gap: 10, padding: 12, borderRadius: 16, backgroundColor: Colors.cream },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 30, paddingHorizontal: 10, borderRadius: 10, backgroundColor: Colors.surface },
  suggestionText: { maxWidth: 140, fontSize: 13, fontFamily: Fonts.bold, color: Colors.inkSoft },
  suggestionHandle: { maxWidth: 120, fontSize: 12, fontFamily: Fonts.semibold, color: Colors.secondaryGray },
  saveRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  saveTitle: { fontSize: 14, fontFamily: Fonts.extrabold, color: Colors.charcoal },
  saveHint: { fontSize: 12, fontFamily: Fonts.semibold, color: Colors.secondaryGray },
  addButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  itemsHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingTop: 4 },
  sectionLabel: { fontSize: 12, fontFamily: Fonts.extrabold, color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8 },
  link: { fontSize: 13, fontFamily: Fonts.extrabold, color: Colors.orangeDeep },
  item: { gap: 8, paddingVertical: 10, borderTopWidth: 1, borderTopColor: Colors.borderLight },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemName: { flex: 1, fontSize: 15, fontFamily: Fonts.bold, color: Colors.charcoal },
  itemAmount: { fontSize: 15, fontFamily: Fonts.extrabold, color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  circles: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  circle: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  circleText: { fontSize: 13, fontFamily: Fonts.black },
  nobody: { fontSize: 12, fontFamily: Fonts.extrabold, color: Colors.expense },
  splitN: { fontSize: 12, fontFamily: Fonts.bold, color: Colors.secondaryGray },
  fix: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  extra: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  extraText: { flex: 1, fontSize: 12, lineHeight: 17, fontFamily: Fonts.semibold, color: Colors.secondaryGray },
  shares: { gap: 10, padding: 12, borderRadius: 16, backgroundColor: Colors.cream },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  dotText: { fontSize: 12, fontFamily: Fonts.black },
  shareName: { fontSize: 15, fontFamily: Fonts.extrabold, color: Colors.charcoal },
  shareHint: { fontSize: 12, fontFamily: Fonts.semibold, color: Colors.secondaryGray },
  shareAmount: { fontSize: 16, fontFamily: Fonts.black, color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.border },
  totalLabel: { fontSize: 14, fontFamily: Fonts.bold, color: Colors.secondaryGray },
  totalValue: { fontSize: 16, fontFamily: Fonts.black, color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  footnote: { fontSize: 12, lineHeight: 17, fontFamily: Fonts.regular, color: Colors.secondaryGray },
}))

