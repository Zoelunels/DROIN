import React from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { router, usePathname } from 'expo-router'
import { Icon, IconTile } from '@/components/ui/Icon'
import { Fonts, makeStyles, useColors } from '@/constants/colors'
import { money } from '@/lib/display'
import { transactionIconName } from '@/lib/icons'
import type { Transaction } from '@/types/api'

function titleFor(t: Transaction) {
  if (t.note) return t.note
  if (t.origin === 'transfer') return 'Transfer'
  return t.category_name ?? 'Entry'
}

/** One transaction: icon tile, note (or category), "Category · Wallet", signed amount. Tap to open it. */
export function TransactionRow({ tx, last }: { tx: Transaction; last?: boolean }) {
  const Colors = useColors()
  const styles = useStyles()
  // Which tab this list is on ("/" is Home), so the details keep that tab lit in the bottom menu.
  const pathname = usePathname()
  const from = pathname === '/' ? 'index' : pathname.slice(1)
  const income = tx.type === 'income'
  const sub = [tx.note ? tx.category_name : null, tx.wallet_name].filter(Boolean).join(' · ')
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: String(tx.id), from } })}
      accessibilityRole="button"
      accessibilityHint="Opens the entry to see details, edit or delete it"
      style={({ pressed }) => [styles.row, !last && styles.divider, { opacity: pressed ? 0.55 : 1 }]}
    >
      <IconTile
        name={transactionIconName(tx)}
        bg={income ? Colors.incomeSoft : Colors.cream}
        color={income ? Colors.income : Colors.charcoal}
      />
      <View style={styles.text}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {titleFor(tx)}
          </Text>
          {tx.attachment_count > 0 ? (
            <Icon name="attach" size={14} color={Colors.secondaryGray} accessibilityLabel="Has a receipt photo" />
          ) : null}
        </View>
        {sub ? (
          <Text style={styles.sub} numberOfLines={1}>
            {sub}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.amount, income && styles.income]} numberOfLines={1}>
        {money(income ? tx.amount : -tx.amount, { sign: true })}
      </Text>
    </Pressable>
  )
}

const useStyles = makeStyles((Colors) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  text: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flexShrink: 1, fontSize: 15, fontFamily: Fonts.extrabold, color: Colors.charcoal },
  sub: { fontFamily: Fonts.regular, fontSize: 13, color: Colors.secondaryGray },
  amount: { fontSize: 15, fontFamily: Fonts.black, color: Colors.charcoal, fontVariant: ['tabular-nums'] },
  income: { color: Colors.income },
}))
