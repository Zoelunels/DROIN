import React, { useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native'
import { Redirect, router, useLocalSearchParams } from 'expo-router'
import { Mascot } from '@/components/Mascot'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Input } from '@/components/ui/Input'
import { Screen } from '@/components/ui/Screen'
import { Endpoints } from '@/constants/api'
import { card, Fonts, makeStyles, useColors } from '@/constants/colors'
import { ApiError, api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { notify } from '@/lib/toast'
import { cleanUsername, usernameProblem } from '@/lib/username'
import type { User } from '@/types/api'

/**
 * Your name and @username. Accounts made before usernames existed land here first (`?required=1`)
 * and can't leave until they pick one, since friends add each other to split bills by username.
 */
export default function Profile() {
  const Colors = useColors()
  const styles = useStyles()
  const { user, isAuthenticated, isLoading, setUser, logout } = useAuth()
  const { required } = useLocalSearchParams<{ required?: string }>()
  const mustPick = required === '1' && !user?.username
  const [name, setName] = useState(user?.name ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!isLoading && !isAuthenticated) return <Redirect href="/login" />

  const usernameError = username ? usernameProblem(username) : null
  const changed = name.trim() !== user?.name || cleanUsername(username) !== (user?.username ?? '')
  const canSave = name.trim() !== '' && username !== '' && !usernameError && changed && !busy

  async function save() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      const updated = await api.put<User>(Endpoints.me, { name: name.trim(), username: cleanUsername(username) })
      await setUser(updated)
      notify.success('Saved.', `You're @${updated.username}`, 'check-circle')
      if (mustPick) router.replace('/')
      else router.back()
    } catch (err) {
      setError(err instanceof ApiError ? (err.offline ? "Can't reach the drawer. Check your connection." : err.message) : 'The drawer jammed. Try again?')
    } finally {
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen bottomSpace={32}>
        <View style={styles.header}>
          {mustPick ? (
            <View style={styles.headerButton} />
          ) : (
            <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" style={styles.headerButton}>
              <Icon name="back" size={24} color={Colors.charcoal} />
            </Pressable>
          )}
          <Text style={styles.headerTitle}>{mustPick ? 'Pick a username' : 'Profile'}</Text>
          <View style={styles.headerButton} />
        </View>

        {mustPick ? (
          <View style={styles.intro}>
            <Mascot size={96} mood="happy" />
            <Text style={styles.introTitle}>One new thing</Text>
            <Text style={styles.introText}>
              DROIN now uses an @username. Friends type it to add you to a split bill, and the bill then shows up in your app too.
            </Text>
          </View>
        ) : null}

        <View style={styles.formCard}>
          <Input label="Name" icon="user" value={name} onChangeText={setName} placeholder="What should we call you?" maxLength={100} />
          <Input
            label="Username"
            icon="user"
            value={username}
            onChangeText={(t) => setUsername(t.replace(/\s/g, ''))}
            placeholder="@budi"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={21}
            autoFocus={mustPick}
            returnKeyType="done"
            onSubmitEditing={save}
            error={usernameError ?? undefined}
            hint={usernameError ? undefined : 'Letters, numbers, "_" and ". ", 3 to 20 characters.'}
          />
          <View style={styles.emailRow}>
            <Icon name="mail" size={16} color={Colors.secondaryGray} />
            <Text style={styles.emailText} numberOfLines={1}>
              {user?.email}
            </Text>
          </View>

          {error ? (
            <View style={styles.errorBox} accessibilityRole="alert">
              <Icon name="alert" size={18} color={Colors.expense} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Button label={mustPick ? 'Use this username' : 'Save'} onPress={save} loading={busy} disabled={!canSave} full size="lg" />
        </View>

        {mustPick ? (
          <Button
            variant="ghost"
            label="Log out instead"
            icon="log-out"
            onPress={async () => {
              await logout()
              router.replace('/login')
            }}
            full
          />
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  )
}

const useStyles = makeStyles((Colors) => ({
  fill: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontFamily: Fonts.extrabold, color: Colors.charcoal },
  intro: { alignItems: 'center', gap: 6, paddingVertical: 8 },
  introTitle: { fontSize: 22, fontFamily: Fonts.black, color: Colors.charcoal },
  introText: { fontSize: 15, lineHeight: 21, fontFamily: Fonts.regular, color: Colors.secondaryGray, textAlign: 'center' },
  formCard: { gap: 14, padding: 18, ...card(Colors), borderRadius: 24 },
  emailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  emailText: { flex: 1, fontSize: 14, fontFamily: Fonts.semibold, color: Colors.secondaryGray },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, backgroundColor: Colors.expenseSoft },
  errorText: { flex: 1, fontSize: 14, lineHeight: 19, fontFamily: Fonts.semibold, color: Colors.expense },
}))
