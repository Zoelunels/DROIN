import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { Colors } from '@/constants/colors'
import { asEmoji, money } from '@/lib/display'
import { categoryEmoji } from '@/lib/emoji'
import type { Transaction } from '@/types/api'

function emojiFor(t: Transaction) {
  if (t.origin === 'transfer') return '🔁'
  if (t.origin === 'transfer_fee') return '🧾'
  if (t.origin === 'debt') return '🤝'
  return asEmoji(t.category_icon) ?? categoryEmoji(t.category_name)
}

function titleFor(t: Transaction) {
  if (t.note) return t.note
  if (t.origin === 'transfer') return 'Transfer'
  return t.category_name ?? 'Entry'
}

/** One transaction: emoji tile, note (or category), "Category · Wallet", signed amount. */
export function TransactionRow({ tx, last }: { tx: Transaction; last?: boolean }) {
  const income = tx.type === 'income'
  const sub = [tx.note ? tx.category_name : null, tx.wallet_name].filter(Boolean).join(' · ')
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <View style={[styles.tile, { backgroundColor: income ? '#EAF0EA' : Colors.cream }]}>
        <Text style={styles.emoji}>{emojiFor(tx)}</Text>
      </View>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {titleFor(tx)}
        </Text>
        {sub ? (
          <Text style={styles.sub} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.amount, income && styles.income]} numberOfLines={1}>
        {money(income ? tx.amount : -tx.amount, { sign: true })}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.borderLight },
  tile: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 19 },
  text: { flex: 1, gap: 2 },
  title: { fontSize: 15, fontWeight: '600', color: Colors.charcoal },
  sub: { fontSize: 13, color: Colors.secondaryGray },
  amount: { fontSize: 15, fontWeight: '700', color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  income: { color: Colors.income },
})
