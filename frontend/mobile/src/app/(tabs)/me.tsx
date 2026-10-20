import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Constants from 'expo-constants'
import { router } from 'expo-router'
import { Mascot } from '@/components/Mascot'
import { Button } from '@/components/ui/Button'
import { Screen } from '@/components/ui/Screen'
import { API_BASE_URL } from '@/constants/api'
import { Colors } from '@/constants/colors'
import { useAuth } from '@/lib/auth'

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  )
}

export default function Me() {
  const { user, logout } = useAuth()
  const [leaving, setLeaving] = useState(false)

  async function onLogout() {
    setLeaving(true)
    await logout()
    router.replace('/login')
  }

  const initial = (user?.name ?? '?').trim().charAt(0).toUpperCase()

  return (
    <Screen inTabs bottomSpace={24}>
      <Text style={styles.title}>Me</Text>

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
        <Row label="Timezone" value={user?.timezone ?? '–'} />
        <Row label="Daily reminder" value={user?.reminder_enabled ? `On, ${user.reminder_time}` : 'Off'} />
        <Row label="Server" value={API_BASE_URL.replace(/^https?:\/\//, '')} />
        <Row label="App version" value={Constants.expoConfig?.version ?? '1.0.0'} last />
      </View>

      <Button variant="secondary" label="Log out" onPress={onLogout} loading={leaving} full />

      <View style={styles.footer}>
        <Mascot size={56} mood="sleepy" sparkle={false} />
        <Text style={styles.footerText}>Your money, in its place.</Text>
      </View>
    </Screen>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 26, fontWeight: '800', color: Colors.charcoal, letterSpacing: -0.5 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 56, height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.softPeach },
  avatarText: { fontSize: 22, fontWeight: '800', color: '#8A4E1E' },
  profileText: { flex: 1, gap: 2 },
  name: { fontSize: 18, fontWeight: '800', color: Colors.charcoal },
  email: { fontSize: 14, color: Colors.secondaryGray },
  card: {
    paddingHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.white,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingVertical: 14 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.borderLight },
  rowLabel: { fontSize: 15, color: Colors.charcoal },
  rowValue: { flexShrink: 1, fontSize: 15, fontWeight: '600', color: Colors.secondaryGray },
  footer: { alignItems: 'center', gap: 8, marginTop: 16 },
  footerText: { fontSize: 13, color: Colors.secondaryGray },
})
