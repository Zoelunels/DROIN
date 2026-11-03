import React, { useRef, useState } from 'react'
import { Dimensions, KeyboardAvoidingView, Platform, Pressable, Text, View, useWindowDimensions, type TextInputInstance } from 'react-native'
import { router } from 'expo-router'
import { Icon } from '@/components/ui/Icon'
import { Mascot, Wordmark } from '@/components/Mascot'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Screen } from '@/components/ui/Screen'
import { card, Fonts, makeStyles, useColors } from '@/constants/colors'
import { ApiError } from '@/lib/api'
import { useAuth } from '@/lib/auth'

type Mode = 'login' | 'register'

const COPY: Record<Mode, { title: string; subtitle: string; action: string; switchText: string; switchLink: string }> = {
  login: {
    title: 'Welcome back',
    subtitle: 'Your money, in its place.',
    action: 'Open the drawer',
    switchText: 'New here?',
    switchLink: 'Make an account',
  },
  register: {
    title: 'Make your drawer',
    subtitle: 'A little drawer for your money.',
    action: 'Make my drawer',
    switchText: 'Already have one?',
    switchLink: 'Log in',
  },
}

export default function Login() {
  const Colors = useColors()
  const styles = useStyles()
  const { login, register } = useAuth()
  useWindowDimensions() // re-render on rotation
  // Screen size, not window size: on Android the window shrinks while the keyboard is open, and
  // switching the mascot size then would make the form jump under your finger.
  const screen = Dimensions.get('screen')
  const [mode, setMode] = useState<Mode>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const emailRef = useRef<TextInputInstance>(null)
  const passwordRef = useRef<TextInputInstance>(null)

  const copy = COPY[mode]
  const compact = screen.height < 700 || screen.width > screen.height // small phones or landscape
  const tooShort = mode === 'register' && password.length > 0 && password.length < 8
  const canSubmit = email.trim() !== '' && password !== '' && !tooShort && !busy

  async function submit() {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      if (mode === 'login') await login(email.trim(), password)
      else await register(email.trim(), password, name.trim() || 'Me')
      router.replace('/')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The drawer jammed. Try again?')
    } finally {
      setBusy(false)
    }
  }

  function switchMode() {
    setMode(mode === 'login' ? 'register' : 'login')
    setError(null)
  }

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen centered bottomSpace={16}>
        <View style={[styles.header, compact && styles.headerCompact]}>
          <Mascot size={compact ? 96 : 140} mood={error ? 'sad' : busy ? 'cheer' : 'happy'} />
          <Wordmark width={compact ? 104 : 132} />
          <View style={styles.titles}>
            <Text style={[styles.title, compact && styles.titleCompact]}>{copy.title}</Text>
            <Text style={styles.subtitle}>{copy.subtitle}</Text>
          </View>
        </View>

        <View style={styles.formCard}>
          {mode === 'register' ? (
            <Input
              label="Name"
              icon="user"
              value={name}
              onChangeText={setName}
              placeholder="What should we call you?"
              autoComplete="name"
              textContentType="name"
              returnKeyType="next"
              onSubmitEditing={() => emailRef.current?.focus()}
              submitBehavior="submit"
            />
          ) : null}
          <Input
            ref={emailRef}
            label="Email"
            icon="mail"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
            submitBehavior="submit"
          />
          <Input
            ref={passwordRef}
            label="Password"
            icon="lock"
            value={password}
            onChangeText={setPassword}
            placeholder={mode === 'register' ? 'At least 8 characters' : 'Your password'}
            secureTextEntry
            autoCapitalize="none"
            autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
            textContentType={mode === 'register' ? 'newPassword' : 'password'}
            returnKeyType="go"
            onSubmitEditing={submit}
            error={tooShort ? 'At least 8 characters.' : undefined}
          />

          {error ? (
            <View style={styles.errorBox} accessibilityRole="alert">
              <Icon name="alert" size={18} color={Colors.expense} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Button label={copy.action} onPress={submit} loading={busy} disabled={!canSubmit} full size="lg" style={styles.submit} />
        </View>

        <View style={styles.switchRow}>
          <Text style={styles.switchText}>{copy.switchText}</Text>
          <Pressable onPress={switchMode} hitSlop={8} accessibilityRole="button">
            {({ pressed }) => <Text style={[styles.switchLink, pressed && { opacity: 0.6 }]}>{copy.switchLink}</Text>}
          </Pressable>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  )
}

const useStyles = makeStyles((Colors) => ({
  fill: { flex: 1, backgroundColor: Colors.background },
  header: { alignItems: 'center', gap: 12, marginBottom: 8 },
  headerCompact: { gap: 6, marginBottom: 4 },
  titles: { alignItems: 'center', gap: 4 },
  title: { fontSize: 28, fontFamily: Fonts.black, color: Colors.charcoal, letterSpacing: -0.6, textAlign: 'center' },
  titleCompact: { fontSize: 24 },
  subtitle: { fontFamily: Fonts.regular, fontSize: 15, color: Colors.secondaryGray, textAlign: 'center' },
  formCard: { gap: 14, padding: 18, ...card(Colors), borderRadius: 24 },
  submit: { marginTop: 6 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: Colors.expenseSoft,
  },
  errorText: { flex: 1, fontSize: 14, lineHeight: 19, fontFamily: Fonts.semibold, color: Colors.expense },
  switchRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, paddingTop: 8 },
  switchText: { fontFamily: Fonts.regular, fontSize: 15, color: Colors.secondaryGray },
  switchLink: { fontSize: 15, fontFamily: Fonts.black, color: Colors.orangeDeep },
}))
