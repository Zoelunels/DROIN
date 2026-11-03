import React, { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { Icon, type IconName } from '@/components/ui/Icon'
import Constants from 'expo-constants'
import { router } from 'expo-router'
import { Mascot, Wordmark } from '@/components/Mascot'
import { PageTitle } from '@/components/ui/Section'
import { Button } from '@/components/ui/Button'
import { Screen } from '@/components/ui/Screen'
import { API_BASE_URL } from '@/constants/api'
import { card, Fonts, makeStyles, useColors, useTheme, type ThemePreference } from '@/constants/colors'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { exportToExcel } from '@/lib/exportExcel'
import { notify } from '@/lib/toast'

const APPEARANCE: { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: 'system', label: 'System', icon: 'phone' },
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
]

/** Light, dark, or whatever the phone is set to. Remembered on this device. */
function Appearance() {
  const Colors = useColors()
  const styles = useStyles()
  const { preference, setPreference } = useTheme()
  return (
    <View style={styles.appearance}>
      <Text style={styles.appearanceTitle}>Appearance</Text>
      <View style={styles.appearanceRow} accessibilityRole="radiogroup">
        {APPEARANCE.map((o) => {
          const on = preference === o.value
          return (
            <Pressable
              key={o.value}
              onPress={() => setPreference(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${o.label} appearance`}
              style={({ pressed }) => [styles.appearanceOption, on ? styles.appearanceOn : pressed && { backgroundColor: Colors.cream }]}
            >
              <Icon name={o.icon} size={20} color={on ? Colors.onOrange : Colors.secondaryGray} strokeWidth={on ? 2.4 : 2} />
              <Text style={[styles.appearanceLabel, on && styles.appearanceLabelOn]}>{o.label}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const styles = useStyles()
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  )
}

/** A tappable row with an icon, title, short description and a chevron (or a spinner while busy). */
function ActionRow({
  icon,
  title,
  subtitle,
  onPress,
  busy,
  last,
}: {
  icon: IconName
  title: string
  subtitle: string
  onPress: () => void
  busy?: boolean
  last?: boolean
}) {
  const Colors = useColors()
  const styles = useStyles()
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
      style={({ pressed }) => [styles.action, !last && styles.divider, { opacity: pressed ? 0.55 : 1 }]}
    >
      <View style={styles.actionIcon}>
        <Icon name={icon} size={20} color={Colors.orangeDeep} />
      </View>
      <View style={styles.actionText}>
        <Text style={styles.actionTitle}>{title}</Text>
        <Text style={styles.actionSub}>{subtitle}</Text>
      </View>
      {busy ? <ActivityIndicator color={Colors.orange} /> : <Icon name="chevron-right" size={18} color={Colors.secondaryGray} />}
    </Pressable>
  )
}

export default function Me() {
  const styles = useStyles()
  const { user, logout } = useAuth()
  const [leaving, setLeaving] = useState(false)
  const [exporting, setExporting] = useState(false)

  async function onExport() {
    setExporting(true)
    try {
      await exportToExcel()
    } catch (err) {
      notify.error(err instanceof ApiError ? (err.offline ? "Can't reach the drawer." : err.message) : "Couldn't make the Excel file.", undefined, 'document')
    } finally {
      setExporting(false)
    }
  }

  async function onLogout() {
    setLeaving(true)
    await logout()
    router.replace('/login')
  }

  const initial = (user?.name ?? '?').trim().charAt(0).toUpperCase()

  return (
    <Screen inTabs bottomSpace={24}>
      <PageTitle eyebrow="Your drawer" title="Me" />

      <View style={styles.profile}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <View style={styles.profileText}>
          <Text style={styles.name} numberOfLines={1}>
            {user?.name}
          </Text>
          <Text style={styles.email} numberOfLines={1}>
            {user?.email}
          </Text>
        </View>
      </View>

      <View style={styles.card}>
        <ActionRow icon="tags" title="Categories" subtitle="Add your own, rename, change icons, hide" onPress={() => router.push('/categories')} />
        <ActionRow
          icon="document"
          title="Export to Excel"
          subtitle="Every entry as an .xlsx file"
          onPress={onExport}
          busy={exporting}
          last
        />
      </View>

      <Appearance />

      <View style={styles.card}>
        <Row label="Timezone" value={user?.timezone ?? '–'} />
        <Row label="Daily reminder" value={user?.reminder_enabled ? `On, ${user.reminder_time}` : 'Off'} />
        <Row label="Server" value={API_BASE_URL.replace(/^https?:\/\//, '')} />
        <Row label="App version" value={Constants.expoConfig?.version ?? '1.0.0'} last />
      </View>

      <Button variant="ghost" label="Log out" icon="log-out" onPress={onLogout} loading={leaving} full />

      <View style={styles.footer}>
        <Mascot size={72} mood="sleepy" />
        <Wordmark width={84} />
        <Text style={styles.footerText}>Your money, in its place.</Text>
      </View>
    </Screen>
  )
}

const useStyles = makeStyles((Colors) => ({
  appearance: { gap: 10, padding: 14, ...card(Colors) },
  appearanceTitle: { fontSize: 15, fontFamily: Fonts.extrabold, color: Colors.charcoal },
  appearanceRow: { flexDirection: 'row', gap: 8 },
  appearanceOption: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 10, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.borderLight },
  appearanceOn: { backgroundColor: Colors.orange, borderColor: Colors.ink, borderBottomWidth: 4 },
  appearanceLabel: { fontSize: 13, fontFamily: Fonts.bold, color: Colors.secondaryGray },
  appearanceLabelOn: { fontFamily: Fonts.black, color: Colors.onOrange },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, ...card(Colors) },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.orange,
    borderWidth: 2,
    borderColor: Colors.ink,
    borderBottomWidth: 5,
  },
  avatarText: { fontSize: 24, fontFamily: Fonts.black, color: Colors.ink },
  profileText: { flex: 1, gap: 1 },
  name: { fontSize: 19, fontFamily: Fonts.black, color: Colors.charcoal },
  email: { fontFamily: Fonts.semibold, fontSize: 14, color: Colors.secondaryGray },
  card: { paddingHorizontal: 16, ...card(Colors) },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingVertical: 14 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  rowLabel: { fontFamily: Fonts.semibold, fontSize: 15, color: Colors.charcoal },
  rowValue: { flexShrink: 1, fontSize: 15, fontFamily: Fonts.bold, color: Colors.secondaryGray },
  action: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  actionIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.orangeSoft },
  actionText: { flex: 1, gap: 1 },
  actionTitle: { fontSize: 16, fontFamily: Fonts.extrabold, color: Colors.charcoal },
  actionSub: { fontFamily: Fonts.regular, fontSize: 13, color: Colors.secondaryGray },
  footer: { alignItems: 'center', gap: 8, marginTop: 12 },
  footerText: { fontFamily: Fonts.semibold, fontSize: 13, color: Colors.muted },
}))
