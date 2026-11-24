import React, { useEffect, useRef, useState } from 'react'
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
import { cleanUsername, usernameProblem } from '@/lib/username'

// No passwords: type your email, get a 6-digit code, type it back. A new email then picks a name and
// an @username (how friends find you for split bills).
type Step = 'email' | 'code' | 'profile'

const RESEND_SECONDS = 60

const COPY: Record<Step, { title: string; subtitle: (email: string) => string }> = {
  email: { title: 'Open your drawer', subtitle: () => "We'll email you a code. No password to remember." },
  code: { title: 'Check your email', subtitle: (email) => `We sent a 6-digit code to ${email}` },
  profile: { title: 'Make your drawer', subtitle: () => 'Last step: what should we call you?' },
}

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : 'The drawer jammed. Try again?')

export default function Login() {
  const Colors = useColors()
  const styles = useStyles()
  const { requestCode, verifyCode } = useAuth()
  useWindowDimensions() // re-render on rotation
  // Screen size, not window size: on Android the window shrinks while the keyboard is open, and
  // switching the mascot size then would make the form jump under your finger.
  const screen = Dimensions.get('screen')
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [username, setUsername] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resendIn, setResendIn] = useState(0)
  const usernameRef = useRef<TextInputInstance>(null)

  // Count down to "send again".
  useEffect(() => {
    if (resendIn <= 0) return
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [resendIn])

  const copy = COPY[step]
  const compact = screen.height < 700 || screen.width > screen.height // small phones or landscape
  const cleanEmail = email.trim().toLowerCase()
  const usernameError = username ? usernameProblem(username) : null

  async function run(task: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await task()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const sendCode = () =>
    run(async () => {
      await requestCode(cleanEmail)
      setCode('')
      setStep('code')
      setResendIn(RESEND_SECONDS)
    })

  const checkCode = (value = code) =>
    run(async () => {
      const result = await verifyCode(cleanEmail, value)
      if (result === 'new-user') setStep('profile')
      else router.replace('/')
    })

  const makeAccount = () =>
    run(async () => {
      await verifyCode(cleanEmail, code, { name: name.trim(), username: cleanUsername(username) })
      router.replace('/')
    })

  function onCode(text: string) {
    const digits = text.replace(/\D/g, '').slice(0, 6)
    setCode(digits)
    if (digits.length === 6 && !busy) checkCode(digits)
  }

  function back() {
    setStep('email')
    setCode('')
    setError(null)
  }

  const canSend = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) && !busy
  const canMake = name.trim() !== '' && username !== '' && !usernameError && !busy

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen centered bottomSpace={16}>
        <View style={[styles.header, compact && styles.headerCompact]}>
          <Mascot size={compact ? 96 : 140} mood={error ? 'sad' : busy ? 'cheer' : 'happy'} />
          <Wordmark width={compact ? 104 : 132} />
          <View style={styles.titles}>
            <Text style={[styles.title, compact && styles.titleCompact]}>{copy.title}</Text>
            <Text style={styles.subtitle}>{copy.subtitle(cleanEmail)}</Text>
          </View>
        </View>

        <View style={styles.formCard}>
          {step === 'email' ? (
            <Input
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
              returnKeyType="go"
              onSubmitEditing={() => canSend && sendCode()}
            />
          ) : null}

          {step === 'code' ? (
            <Input
              label="Code"
              icon="lock"
              value={code}
              onChangeText={onCode}
              placeholder="6 digits"
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              style={styles.codeInput}
              hint="It works for 10 minutes. Not there? Check spam."
            />
          ) : null}

          {step === 'profile' ? (
            <>
              <Input
                label="Name"
                icon="user"
                value={name}
                onChangeText={setName}
                placeholder="What should we call you?"
                autoFocus
                autoComplete="name"
                textContentType="name"
                returnKeyType="next"
                onSubmitEditing={() => usernameRef.current?.focus()}
                submitBehavior="submit"
                maxLength={100}
              />
              <Input
                ref={usernameRef}
                label="Username"
                icon="user"
                value={username}
                onChangeText={(t) => setUsername(t.replace(/\s/g, ''))}
                placeholder="@budi"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="username-new"
                textContentType="username"
                returnKeyType="go"
                onSubmitEditing={() => canMake && makeAccount()}
                maxLength={21}
                error={usernameError ?? undefined}
                hint={usernameError ? undefined : 'Friends use it to add you to a split bill.'}
              />
            </>
          ) : null}

          {error ? (
            <View style={styles.errorBox} accessibilityRole="alert">
              <Icon name="alert" size={18} color={Colors.expense} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {step === 'email' ? (
            <Button label="Send me a code" onPress={sendCode} loading={busy} disabled={!canSend} full size="lg" style={styles.submit} />
          ) : step === 'code' ? (
            <Button label="Open the drawer" onPress={() => checkCode()} loading={busy} disabled={code.length !== 6 || busy} full size="lg" style={styles.submit} />
          ) : (
            <Button label="Make my drawer" onPress={makeAccount} loading={busy} disabled={!canMake} full size="lg" style={styles.submit} />
          )}
        </View>

        {step === 'code' ? (
          <View style={styles.switchRow}>
            <Pressable onPress={back} hitSlop={8} accessibilityRole="button">
              {({ pressed }) => <Text style={[styles.switchLink, pressed && { opacity: 0.6 }]}>Other email</Text>}
            </Pressable>
            <Text style={styles.switchText}>·</Text>
            {resendIn > 0 ? (
              <Text style={styles.switchText}>Send again in {resendIn}s</Text>
            ) : (
              <Pressable onPress={sendCode} disabled={busy} hitSlop={8} accessibilityRole="button">
                {({ pressed }) => <Text style={[styles.switchLink, pressed && { opacity: 0.6 }]}>Send again</Text>}
              </Pressable>
            )}
          </View>
        ) : step === 'profile' ? (
          <View style={styles.switchRow}>
            <Pressable onPress={back} hitSlop={8} accessibilityRole="button">
              {({ pressed }) => <Text style={[styles.switchLink, pressed && { opacity: 0.6 }]}>Use another email</Text>}
            </Pressable>
          </View>
        ) : null}
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
  codeInput: { fontSize: 22, letterSpacing: 6, fontFamily: Fonts.black },
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
