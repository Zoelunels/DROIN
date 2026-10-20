import React, { useCallback, useEffect, useRef, useState } from 'react'
import { KeyboardAvoidingView, Linking, Platform, StyleSheet, Text, TextInput, View } from 'react-native'
import { router, useFocusEffect } from 'expo-router'
import { DraftCard, draftAmount, draftProblem, toEditable, type EditableDraft } from '@/components/voice/DraftCard'
import { MicButton } from '@/components/voice/MicButton'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Screen } from '@/components/ui/Screen'
import { Banner } from '@/components/ui/States'
import { Endpoints } from '@/constants/api'
import { Colors } from '@/constants/colors'
import { MAX_RECORDING_MS, useVoiceRecorder } from '@/hooks/useVoiceRecorder'
import { ApiError, api } from '@/lib/api'
import { notify } from '@/lib/toast'
import type { Category, QuickDraft, VoiceResult, Wallet } from '@/types/api'

type Phase = 'idle' | 'recording' | 'sending' | 'review'
type Problem = { kind: 'permission' | 'blocked' | 'empty' | 'offline' | 'unavailable' | 'soon' | 'other'; message: string }

// Voice needs a speech-to-text key on the server (STT_API_KEY in backend/.env). Until one is set
// up, the mic is shown as "soon": tapping it records nothing and points to the type box instead.
// Flip to true once the key is in place; the recording/upload code below is ready.
const VOICE_READY = false

const HOLD_MS = 450 // pressed longer than this = hold-to-talk; shorter = tap to start, tap to stop
const MIN_SPEECH_MS = 700

function problemFrom(err: unknown): Problem {
  if (err instanceof ApiError) {
    if (err.offline) return { kind: 'offline', message: "You're offline, or the drawer is out of reach. Check the connection and try again." }
    if (err.status === 422) return { kind: 'empty', message: err.message }
    if (err.status === 503) return { kind: 'unavailable', message: "Voice isn't set up on the server yet. Type it below instead." }
    return { kind: 'other', message: err.message }
  }
  return { kind: 'other', message: 'The drawer jammed. Try again?' }
}

export default function Voice() {
  const mic = useVoiceRecorder()
  const [phase, setPhase] = useState<Phase>('idle')
  const [problem, setProblem] = useState<Problem | null>(null)
  const [transcript, setTranscript] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<EditableDraft[]>([])
  const [typed, setTyped] = useState('')
  const [saving, setSaving] = useState(false)
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [categories, setCategories] = useState<Category[]>([])

  const pressedAt = useRef(0)
  const typeRef = useRef<TextInput>(null)
  const starting = useRef(false)
  const stopWhenStarted = useRef(false)
  const phaseRef = useRef<Phase>('idle')
  phaseRef.current = phase

  const loadLists = useCallback(async () => {
    try {
      const [w, c] = await Promise.all([api.get<Wallet[]>(Endpoints.wallets), api.get<Category[]>(Endpoints.categories)])
      setWallets(w)
      setCategories(c.filter((x) => !x.system_key))
    } catch {
      // Shown again when saving; the mic still works for the transcript.
    }
  }, [])
  // Wallets can be added in the Wallets tab, so refresh the pickers every time this tab opens.
  useFocusEffect(
    useCallback(() => {
      loadLists()
    }, [loadLists]),
  )

  function showDrafts(heard: string, parsed: QuickDraft[]) {
    setTranscript(heard)
    setDrafts(parsed.map(toEditable))
    setPhase('review')
  }

  const finish = useCallback(async () => {
    if (phaseRef.current !== 'recording') return
    phaseRef.current = 'sending' // before re-render, so a second press-out can't stop twice
    setPhase('sending')
    let recording
    try {
      recording = await mic.stop()
    } catch {
      recording = null
    }
    if (!recording || recording.durationMs < MIN_SPEECH_MS) {
      setProblem({ kind: 'empty', message: 'That was quick. Hold the mic and say what you spent.' })
      setPhase('idle')
      return
    }
    try {
      const form = new FormData()
      // React Native uploads a local file from { uri, name, type }.
      form.append('audio', { uri: recording.uri, name: 'voice.m4a', type: 'audio/m4a' } as unknown as Blob)
      const result = await api.upload<VoiceResult>(Endpoints.quickInputVoice, form)
      showDrafts(result.transcript, result.drafts)
    } catch (err) {
      setProblem(problemFrom(err))
      setPhase('idle')
    }
  }, [mic])

  const begin = useCallback(async () => {
    if (starting.current) return
    starting.current = true
    stopWhenStarted.current = false
    setProblem(null)
    try {
      const permission = await mic.start()
      if (permission !== 'granted') {
        setProblem(
          permission === 'blocked'
            ? { kind: 'blocked', message: 'DROIN needs the microphone to hear you. Turn it on in Settings, or type it below.' }
            : { kind: 'permission', message: 'No mic, no listening. Allow the microphone, or type it below.' },
        )
        return
      }
      setPhase('recording')
      phaseRef.current = 'recording'
      if (stopWhenStarted.current) finish() // released before the recorder was ready
    } catch {
      setProblem({ kind: 'other', message: "The mic didn't start. Close other apps using it and try again." })
    } finally {
      starting.current = false
    }
  }, [mic, finish])

  // Stop on our own at the limit, so a forgotten tap doesn't record forever.
  useEffect(() => {
    if (phase === 'recording' && mic.durationMs >= MAX_RECORDING_MS) finish()
  }, [phase, mic.durationMs, finish])

  function onPressIn() {
    if (!VOICE_READY) {
      setProblem({ kind: 'soon', message: 'Voice is coming soon. Type it below for now, same drawer.' })
      typeRef.current?.focus()
      return
    }
    if (phaseRef.current === 'recording') {
      pressedAt.current = Date.now()
      finish() // second tap in tap mode
      return
    }
    pressedAt.current = Date.now()
    begin()
  }

  function onPressOut() {
    if (!VOICE_READY) return
    if (Date.now() - pressedAt.current < HOLD_MS) return // a tap: keep listening until the next tap
    if (starting.current) stopWhenStarted.current = true
    else finish()
  }

  async function parseTyped() {
    const text = typed.trim()
    if (!text) return
    setProblem(null)
    setPhase('sending')
    try {
      const draft = await api.post<QuickDraft>(Endpoints.quickInput, { text })
      showDrafts(text, [draft])
      setTyped('')
    } catch (err) {
      setProblem(problemFrom(err))
      setPhase('idle')
    }
  }

  async function createCashWallet() {
    try {
      const w = await api.post<Wallet>(Endpoints.wallets, { name: 'Cash', wallet_type: 'cash' })
      await loadLists()
      setDrafts((ds) => ds.map((d) => (d.walletId ? d : { ...d, walletId: w.id })))
    } catch (err) {
      notify.error(problemFrom(err).message)
    }
  }

  async function saveAll() {
    const pending = drafts.filter((d) => !d.saved)
    const blocker = pending.map(draftProblem).find(Boolean)
    if (blocker) {
      notify.info(blocker, undefined, '✏️')
      return
    }
    setSaving(true)
    let saved = 0
    for (const d of pending) {
      try {
        await api.post(
          Endpoints.transactions,
          {
            wallet_id: d.walletId,
            category_id: d.categoryId,
            type: d.type,
            amount: draftAmount(d),
            transaction_date: d.date,
            note: d.note.trim() || null,
          },
          { 'Idempotency-Key': d.key },
        )
        saved++
        setDrafts((ds) => ds.map((x) => (x.key === d.key ? { ...x, saved: true } : x)))
      } catch (err) {
        setSaving(false)
        notify.error(problemFrom(err).message, saved > 0 ? `${saved} saved, the rest is still here.` : undefined)
        return
      }
    }
    setSaving(false)
    notify.saved(saved > 1 ? `${saved} entries` : 'Entry')
    reset()
    router.navigate('/') // show it on Home
  }

  function reset() {
    setDrafts([])
    setTranscript(null)
    setProblem(null)
    setPhase('idle')
  }

  const update = (key: string, patch: Partial<EditableDraft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)))

  const seconds = Math.floor(mic.durationMs / 1000)
  const pendingCount = drafts.filter((d) => !d.saved).length

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen inTabs bottomSpace={32}>
        <View style={styles.headerText}>
          <Text style={styles.hello}>New entry</Text>
          <Text style={styles.title}>Put something in</Text>
        </View>

        {phase !== 'review' ? (
          <View style={styles.micArea}>
            <MicButton
              soon={!VOICE_READY}
              recording={phase === 'recording'}
              busy={phase === 'sending'}
              level={mic.level}
              onPressIn={onPressIn}
              onPressOut={onPressOut}
            />
            <Text style={styles.micLabel}>
              {phase === 'recording'
                ? `Listening… 0:${String(seconds).padStart(2, '0')}`
                : phase === 'sending'
                  ? 'Writing that down…'
                  : VOICE_READY
                    ? 'Hold to talk'
                    : 'Voice is coming soon'}
            </Text>
            {phase === 'recording' ? (
              <Text style={styles.micHint}>Let go, or tap again, when you’re done.</Text>
            ) : (
              <View style={styles.examples}>
                <Text style={styles.micHint}>{VOICE_READY ? 'Try' : 'For now, type it like'}</Text>
                <Text style={styles.example}>“makan 25 ribu pakai gopay kemarin”</Text>
                <Text style={styles.example}>“kopi 18rb, parkir goceng”</Text>
              </View>
            )}
          </View>
        ) : null}

        {problem ? (
          <View style={styles.problem}>
            <Banner
              emoji={problem.kind === 'offline' ? '📡' : problem.kind === 'empty' ? '👂' : problem.kind === 'soon' ? '⌨️' : '🎙️'}
              tone={problem.kind === 'empty' || problem.kind === 'soon' ? 'brand' : 'expense'}
              text={problem.message}
            />
            {problem.kind === 'blocked' ? (
              <Button variant="secondary" size="sm" label="Open Settings" onPress={() => Linking.openSettings()} />
            ) : null}
          </View>
        ) : null}

        {phase === 'idle' ? (
          <View style={styles.typeCard}>
            <Text style={styles.sectionLabel}>Or type it</Text>
            <View style={styles.typeRow}>
              <View style={styles.typeInput}>
                <Input
                  ref={typeRef}
                  value={typed}
                  onChangeText={setTyped}
                  placeholder="makan 25k gopay kemarin"
                  returnKeyType="done"
                  onSubmitEditing={parseTyped}
                  autoCorrect={false}
                />
              </View>
              <Button label="Sort it" onPress={parseTyped} disabled={!typed.trim()} style={styles.typeButton} />
            </View>
          </View>
        ) : null}

        {phase === 'review' ? (
          <View style={styles.review}>
            {transcript ? (
              <View style={styles.heard}>
                <Text style={styles.sectionLabel}>Heard</Text>
                <Text style={styles.transcript}>“{transcript}”</Text>
              </View>
            ) : null}

            {drafts.map((d) => (
              <DraftCard
                key={d.key}
                draft={d}
                wallets={wallets}
                categories={categories}
                onChange={(patch) => update(d.key, patch)}
                onRemove={drafts.length > 1 ? () => setDrafts((ds) => ds.filter((x) => x.key !== d.key)) : undefined}
                onCreateWallet={createCashWallet}
              />
            ))}

            <Button
              label={pendingCount > 1 ? `Put all ${pendingCount} in` : 'Put it in'}
              onPress={saveAll}
              loading={saving}
              disabled={pendingCount === 0}
              size="lg"
              full
            />
            <Button variant="ghost" label="Start over" onPress={reset} disabled={saving} full />
          </View>
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: Colors.background },
  headerText: { gap: 2 },
  hello: { fontSize: 14, fontWeight: '600', color: Colors.secondaryGray },
  title: { fontSize: 26, fontWeight: '800', color: Colors.charcoal, letterSpacing: -0.5 },
  micArea: { alignItems: 'center', gap: 6, paddingVertical: 8 },
  micLabel: { fontSize: 18, fontWeight: '700', color: Colors.charcoal, textAlign: 'center' },
  micHint: { fontSize: 13, lineHeight: 18, color: Colors.secondaryGray, textAlign: 'center' },
  examples: { alignItems: 'center', gap: 2, marginTop: 2 },
  example: { fontSize: 14, lineHeight: 20, color: Colors.charcoal, fontStyle: 'italic', textAlign: 'center' },
  problem: { gap: 8 },
  typeCard: { gap: 8, padding: 14, borderRadius: 16, backgroundColor: Colors.cream },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: Colors.secondaryGray },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  typeInput: { flex: 1 },
  typeButton: { height: 52 },
  review: { gap: 14 },
  heard: { gap: 4, paddingHorizontal: 2 },
  transcript: { fontSize: 17, lineHeight: 24, fontWeight: '600', color: Colors.charcoal, fontStyle: 'italic' },
})
