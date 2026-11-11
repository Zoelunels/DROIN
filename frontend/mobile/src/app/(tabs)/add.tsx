import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Image, KeyboardAvoidingView, Linking, Platform, Pressable, Switch, Text, View, type TextInputInstance } from 'react-native'
import { Icon, type IconName } from '@/components/ui/Icon'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { Mascot } from '@/components/Mascot'
import { ReceiptBreakdown, itemsNote, toEditableItems, type EditableItem, type SaveMode } from '@/components/ReceiptBreakdown'
import { SplitBill } from '@/components/SplitBill'
import { DraftCard, draftAmount, draftProblem, toEditable, type EditableDraft } from '@/components/voice/DraftCard'
import { MicButton } from '@/components/voice/MicButton'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Screen } from '@/components/ui/Screen'
import { PageTitle } from '@/components/ui/Section'
import { Banner } from '@/components/ui/States'
import { Endpoints } from '@/constants/api'
import { card, Fonts, ledge, makeStyles, useColors } from '@/constants/colors'
import { MAX_RECORDING_MS, useVoiceRecorder } from '@/hooks/useVoiceRecorder'
import { ApiError, api } from '@/lib/api'
import { money } from '@/lib/display'
import { attachReceipt, fileField, pickInvoicePdf, pickReceiptPhoto, scanReceipt, type ReceiptFile } from '@/lib/receipt'
import { ME_KEY, billItems, billProblem, startBill, type BillState } from '@/lib/split'
import { notify } from '@/lib/toast'
import type { Category, QuickDraft, Split, Transaction, VoiceResult, Wallet } from '@/types/api'

type Phase = 'idle' | 'recording' | 'sending' | 'review'
type Problem = { kind: 'permission' | 'blocked' | 'camera' | 'empty' | 'offline' | 'unavailable' | 'soon' | 'other'; message: string }
type Source = 'voice' | 'typed' | 'receipt' | 'invoice'
const SOURCE_LABEL: Record<Source, string> = {
  voice: 'Heard',
  typed: 'Typed',
  receipt: 'Read from the receipt',
  invoice: 'Read from the invoice',
}

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
    if (err.status === 503) return { kind: 'unavailable', message: "Voice isn't set up on the server yet. Type it instead." }
    return { kind: 'other', message: err.message }
  }
  return { kind: 'other', message: 'The drawer jammed. Try again?' }
}

export default function Voice() {
  const Colors = useColors()
  const styles = useStyles()
  const mic = useVoiceRecorder()
  const [phase, setPhase] = useState<Phase>('idle')
  const [problem, setProblem] = useState<Problem | null>(null)
  const [transcript, setTranscript] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<EditableDraft[]>([])
  const [typed, setTyped] = useState('')
  const [saving, setSaving] = useState(false)
  const [wallets, setWallets] = useState<Wallet[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [source, setSource] = useState<Source>('typed')
  const [busyLabel, setBusyLabel] = useState('Writing that down…')
  // The scanned receipt photo or invoice PDF, kept on this device until the entry is saved. `keep` off
  // is "scan only": its numbers are used, the file isn't uploaded. `items` is the line-by-line
  // breakdown; `mode` saves it as one entry (items in the note), one entry per item, or a split bill
  // shared with friends (`bill`: who's in it and who had what). `base` is the receipt's own draft,
  // kept so switching back from separate entries restores it.
  const [receipt, setReceipt] = useState<{
    file: ReceiptFile
    draftKey: string
    keep: boolean
    text: string
    items: EditableItem[]
    mode: SaveMode
    base: EditableDraft
    bill: BillState | null
  } | null>(null)
  const [showRead, setShowRead] = useState(false)

  const pressedAt = useRef(0)
  const typeRef = useRef<TextInputInstance>(null)
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

  // Home's quick actions open this tab with ?start=camera|pdf|type. `at` makes each tap new, so the
  // same action works twice in a row; a tap is ignored while something else is on screen.
  const { start, at } = useLocalSearchParams<{ start?: string; at?: string }>()
  const handledAt = useRef<string | undefined>(undefined)
  const startAction = useRef<(kind: string) => void>(() => {})
  startAction.current = (kind) => {
    if (phaseRef.current !== 'idle') return
    if (kind === 'camera' || kind === 'pdf') scanFrom(kind)
    else if (kind === 'type') setTimeout(() => typeRef.current?.focus(), 250)
  }
  useEffect(() => {
    if (!start || !at || handledAt.current === at) return
    handledAt.current = at
    startAction.current(start)
  }, [start, at])

  function showDrafts(heard: string, parsed: QuickDraft[], from: Source) {
    const editable = parsed.map(toEditable)
    setTranscript(heard)
    setSource(from)
    setDrafts(editable)
    setPhase('review')
    return editable
  }

  async function scanFrom(from: 'camera' | 'library' | 'pdf') {
    setProblem(null)
    let picked
    try {
      picked = from === 'pdf' ? await pickInvoicePdf() : await pickReceiptPhoto(from)
    } catch {
      setProblem({ kind: 'other', message: `Couldn't open the ${from === 'pdf' ? 'file' : 'photo'}. Try another one.` })
      return
    }
    if (picked === 'canceled') return
    if (picked === 'denied') {
      setProblem({ kind: 'camera', message: 'DROIN needs the camera to photograph receipts. Turn it on in Settings, or pick from the gallery.' })
      return
    }
    if (picked === 'too-big') {
      setProblem({ kind: 'other', message: 'That PDF is over 5 MB. Try a screenshot of the invoice instead.' })
      return
    }
    setBusyLabel(from === 'pdf' ? 'Reading the invoice…' : 'Reading the receipt…')
    setPhase('sending')
    try {
      const scan = await scanReceipt(picked)
      const summary = [scan.merchant, scan.total ? money(scan.total) : null, scan.payment].filter(Boolean).join(' · ')
      const [draft] = showDrafts(summary || (scan.kind === 'invoice' ? 'Invoice' : 'Receipt'), [scan.draft], scan.kind)
      setReceipt({ file: picked, draftKey: draft!.key, keep: true, text: scan.text, items: toEditableItems(scan.items ?? []), mode: 'one', base: draft!, bill: null })
      setShowRead(false)
      if (!scan.total) notify.info("Couldn't spot the total.", `Type the amount from the ${scan.kind}.`, 'receipt')
    } catch (err) {
      setProblem(problemFrom(err))
      setPhase('idle')
    } finally {
      setBusyLabel('Writing that down…')
    }
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
      form.append('audio', await fileField(recording.uri), 'voice.m4a')
      const result = await api.upload<VoiceResult>(Endpoints.quickInputVoice, form)
      showDrafts(result.transcript, result.drafts, 'voice')
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
      setProblem({ kind: 'soon', message: 'Voice is coming soon. Type it or scan a receipt for now, same drawer.' })
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
      showDrafts(text, [draft], 'typed')
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
    if (receipt?.mode === 'bill') return saveBill()
    const pending = drafts.filter((d) => !d.saved)
    const blocker = pending.map(draftProblem).find(Boolean)
    if (blocker) {
      notify.info(blocker, undefined, 'edit')
      return
    }
    setSaving(true)
    let saved = 0
    // The photo goes with the receipt's entry (with the first one when split into separate entries),
    // and nowhere when the user chose "scan only".
    const attachKey = receipt?.keep ? (receipt.mode === 'split' ? pending[0]?.key : receipt.draftKey) : null
    for (const d of pending) {
      // One entry for a whole receipt: its items go into the note ("Indomie Goreng 9.300, Aqua 8.000").
      const breakdown = receipt?.mode === 'one' && d.key === receipt.draftKey ? itemsNote(receipt.items) : ''
      const note = [d.note.trim(), breakdown].filter(Boolean).join(': ').slice(0, 500)
      try {
        const created = await api.post<Transaction>(
          Endpoints.transactions,
          {
            wallet_id: d.walletId,
            category_id: d.categoryId,
            type: d.type,
            amount: draftAmount(d),
            transaction_date: d.date,
            note: note || null,
          },
          { 'Idempotency-Key': d.key },
        )
        saved++
        if (receipt && attachKey === d.key) {
          // The entry is saved either way; a failed upload can be redone from the entry.
          await attachReceipt(created.id, receipt.file).catch(() =>
            notify.info(
              `Saved, but the ${receipt.file.type === 'application/pdf' ? 'invoice' : 'receipt photo'} didn't upload.`,
              'Open the entry to add it again.',
              'receipt',
            ),
          )
        }
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
    setReceipt(null)
    setTranscript(null)
    setProblem(null)
    setPhase('idle')
  }

  const update = (key: string, patch: Partial<EditableDraft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)))

  /** One entry, one entry per item (same wallet, category and date to start with), or a split bill. */
  function setSaveMode(mode: SaveMode) {
    if (!receipt) return
    let base = receipt
    if (receipt.mode === 'split') {
      // Leaving "per item": the separate entries become the breakdown again (with any edits made there).
      const items = drafts.map((d) => ({ key: d.key, name: d.note, amountText: d.amountText }))
      setDrafts([receipt.base])
      base = { ...receipt, items, draftKey: receipt.base.key }
    }
    if (mode === 'split') {
      const current = drafts.find((d) => d.key === base.draftKey) ?? base.base
      const stamp = Date.now().toString(36)
      const split = base.items
        .filter((i) => Number(i.amountText) > 0)
        .map((i, n) => ({ ...current, key: `${current.key}-${stamp}-${n}`, amountText: i.amountText, note: i.name.trim(), guessed: { ...current.guessed, amount: false } }))
      setDrafts(split)
      setReceipt({ ...base, mode, base: current })
    } else {
      setReceipt({ ...base, mode, bill: mode === 'bill' ? base.bill ?? startBill(base.items) : base.bill })
    }
  }

  /** The split bill as it will be saved: its lines, and who had each (new lines start with you). */
  function billOf(r: NonNullable<typeof receipt>, d: EditableDraft | undefined) {
    const total = d ? draftAmount(d) : 0
    const items = billItems(r.items, total, d?.note.trim() ?? '')
    const bill = r.bill ?? startBill(items)
    const assign = Object.fromEntries(items.map((i) => [i.key, bill.assign[i.key] ?? [ME_KEY]]))
    return { items, total, bill: { ...bill, assign } }
  }

  async function saveBill() {
    if (!receipt) return
    const d = drafts.find((x) => x.key === receipt.draftKey)
    if (!d) return
    const { items, total, bill } = billOf(receipt, d)
    const blocker = draftProblem(d) ?? (d.type !== 'expense' ? 'A split bill is for spending: switch the entry to Expense.' : null) ?? billProblem(items, bill, total)
    if (blocker) {
      notify.info(blocker, undefined, 'edit')
      return
    }
    setSaving(true)
    try {
      const created = await api.post<Split>(
        Endpoints.splits,
        {
          title: (d.note.trim() || 'Split bill').slice(0, 100),
          total,
          split_date: d.date,
          wallet_id: d.walletId,
          category_id: d.categoryId,
          people: bill.people.map((p) => ({
            name: p.me ? 'You' : p.name,
            me: p.me || undefined,
            friend_id: p.friendId ?? undefined,
            save_as_friend: p.save || undefined,
          })),
          items: items.map((i) => ({
            name: i.name.trim() || 'Item',
            amount: Number(i.amountText),
            people: bill.assign[i.key]!.map((k) => bill.people.findIndex((p) => p.key === k)),
          })),
        },
        { 'Idempotency-Key': d.key },
      )
      // The photo goes with your own share's entry (there is none if you only paid for others).
      if (receipt.keep && created.transaction_id) {
        await attachReceipt(created.transaction_id, receipt.file).catch(() =>
          notify.info('Saved, but the receipt photo didn’t upload.', 'Open your entry to add it again.', 'receipt'),
        )
      }
      const others = created.people.filter((p) => !p.is_me).length
      notify.success('Split saved.', `${others === 1 ? created.people.find((p) => !p.is_me)!.name : `${others} people`} owe${others === 1 ? 's' : ''} you ${money(created.owed_to_me)}.`, 'people')
      reset()
      router.push({ pathname: '/splits/[id]', params: { id: String(created.id) } })
    } catch (err) {
      notify.error(problemFrom(err).message)
    } finally {
      setSaving(false)
    }
  }

  const receiptDraft = receipt ? drafts.find((d) => d.key === receipt.draftKey) : undefined

  const seconds = Math.floor(mic.durationMs / 1000)
  const pendingCount = drafts.filter((d) => !d.saved).length

  const micBlock =
    phase !== 'review' && (VOICE_READY || phase === 'recording') ? (
      <View style={styles.micArea}>
        <MicButton
          recording={phase === 'recording'}
          busy={phase === 'sending'}
          level={mic.level}
          onPressIn={onPressIn}
          onPressOut={onPressOut}
        />
        <Text style={styles.micLabel}>
          {phase === 'recording' ? `Listening… 0:${String(seconds).padStart(2, '0')}` : phase === 'sending' ? busyLabel : 'Hold to talk'}
        </Text>
        {phase === 'recording' ? <Text style={styles.micHint}>Let go, or tap again, when you’re done.</Text> : null}
      </View>
    ) : null

  return (
    <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen inTabs bottomSpace={32}>
        <PageTitle
          eyebrow={phase === 'review' ? 'Check it, then save' : 'New entry'}
          title={phase === 'review' ? (pendingCount > 1 ? `${pendingCount} entries` : 'Look right?') : 'Put something in'}
        />

        {micBlock}

        {/* Reading a receipt / sorting typed words takes a few seconds: say so, with the mascot. */}
        {phase === 'sending' && !VOICE_READY ? (
          <View style={styles.busyCard} accessibilityLiveRegion="polite">
            <Mascot size={96} mood="curious" />
            <Text style={styles.busyTitle}>{busyLabel}</Text>
            <Text style={styles.busyHint}>
              {busyLabel.startsWith('Reading') ? 'Finding the total, date and shop. A few seconds.' : 'Sorting amount, category and wallet.'}
            </Text>
          </View>
        ) : null}

        {problem ? (
          <View style={styles.problem}>
            <Banner
              icon={problem.kind === 'offline' ? 'offline' : problem.kind === 'empty' ? 'search' : problem.kind === 'soon' ? 'keyboard' : problem.kind === 'camera' ? 'camera' : 'mic'}
              tone={problem.kind === 'empty' || problem.kind === 'soon' ? 'brand' : 'expense'}
              text={problem.message}
            />
            {problem.kind === 'blocked' || problem.kind === 'camera' ? (
              <Button variant="secondary" size="sm" label="Open Settings" onPress={() => Linking.openSettings()} />
            ) : null}
          </View>
        ) : null}

        {phase === 'idle' ? (
          <View style={styles.typeCard}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>Type it</Text>
              <Text style={styles.cardSub}>{"Like you'd text a friend. Bahasa or English."}</Text>
            </View>
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
            <View style={styles.examples}>
              {EXAMPLES.map((ex) => (
                <Pressable
                  key={ex}
                  onPress={() => {
                    setTyped(ex)
                    typeRef.current?.focus()
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Use example: ${ex}`}
                  style={({ pressed }) => [styles.example, pressed && { backgroundColor: Colors.orangeSoft }]}
                >
                  <Text style={styles.exampleText}>{ex}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {phase === 'idle' ? (
          <View style={styles.scanBlock}>
            <View style={styles.cardHead}>
              <Text style={styles.cardTitle}>Got a receipt or invoice?</Text>
              <Text style={styles.cardSub}>DROIN reads the total, date and shop for you.</Text>
            </View>
            <View style={styles.tiles}>
              <ScanTile icon="camera" label="Photo" sub="Struk / nota" onPress={() => scanFrom('camera')} primary />
              <ScanTile icon="gallery" label="Gallery" sub="Screenshot too" onPress={() => scanFrom('library')} />
              <ScanTile icon="document" label="PDF" sub="E-invoice" onPress={() => scanFrom('pdf')} />
            </View>
          </View>
        ) : null}

        {phase === 'idle' && !VOICE_READY ? (
          <Pressable onPress={onPressIn} accessibilityRole="button" accessibilityLabel="Voice input, coming soon" style={styles.voiceSoon}>
            <View style={styles.voiceIcon}>
              <Icon name="mic" size={18} color={Colors.orangeDeep} />
            </View>
            <Text style={styles.voiceText}>Talk it in</Text>
            <View style={styles.soonBadge}>
              <Text style={styles.soonText}>SOON</Text>
            </View>
          </Pressable>
        ) : null}

        {phase === 'review' ? (
          <View style={styles.review}>
            {transcript ? (
              <View style={styles.heardRow}>
                {receipt?.file.type === 'application/pdf' ? (
                  <View style={[styles.receiptThumb, styles.pdfThumb]} accessibilityLabel="Invoice PDF">
                    <Icon name="document" size={26} color={Colors.orangeDeep} />
                    <Text style={styles.pdfName} numberOfLines={2}>
                      {receipt.file.name}
                    </Text>
                  </View>
                ) : receipt ? (
                  <Image source={{ uri: receipt.file.uri }} style={styles.receiptThumb} accessibilityLabel="Receipt photo" />
                ) : (
                  <View style={styles.sourceIcon}>
                    <Icon name={source === 'voice' ? 'mic' : 'message'} size={20} color={Colors.orangeDeep} />
                  </View>
                )}
                <View style={styles.heard}>
                  <Text style={styles.sectionLabel}>{SOURCE_LABEL[source]}</Text>
                  <Text style={styles.transcript} numberOfLines={3}>
                    {receipt ? transcript : `“${transcript}”`}
                  </Text>
                </View>
              </View>
            ) : null}

            {receipt ? (
              <View style={styles.receiptOptions}>
                {/* Scan only, or keep the photo with the entry. */}
                <View style={styles.keepRow}>
                  <Icon name={receipt.keep ? 'attach' : 'eye-off'} size={18} color={receipt.keep ? Colors.income : Colors.secondaryGray} />
                  <View style={styles.flex}>
                    <Text style={styles.keepTitle}>Keep the {receipt.file.type === 'application/pdf' ? 'PDF' : 'photo'} with the entry</Text>
                    <Text style={styles.keepHint}>
                      {receipt.keep ? 'You can open it later from the entry.' : 'Scan only: the numbers are used, the file is not saved.'}
                    </Text>
                  </View>
                  <Switch
                    value={receipt.keep}
                    onValueChange={(keep) => setReceipt({ ...receipt, keep })}
                    trackColor={{ true: Colors.orange, false: Colors.border }}
                    thumbColor={Colors.onColor}
                    accessibilityLabel="Keep the photo with the entry"
                  />
                </View>
                {/* The raw OCR text, so a wrong number can be traced to a misread or a mix-up. */}
                <Pressable
                  onPress={() => setShowRead((v) => !v)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showRead }}
                  style={styles.readToggle}
                >
                  <Icon name="document" size={16} color={Colors.orangeDeep} />
                  <Text style={styles.readToggleText}>{showRead ? 'Hide' : 'See'} what DROIN read</Text>
                  <Icon name={showRead ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.orangeDeep} />
                </Pressable>
                {showRead ? (
                  <Text style={styles.readText} selectable>
                    {receipt.text || 'No text came back from the scan.'}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {receipt && receipt.mode === 'split' ? (
              <ReceiptBreakdown items={receipt.items} onChange={(items) => setReceipt({ ...receipt, items })} mode="split" onModeChange={setSaveMode} entryAmount={0} />
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
                onCategoryCreated={(c) => setCategories((prev) => [...prev, c])}
              />
            ))}

            {receipt && receipt.mode === 'bill' ? (
              <>
                <ReceiptBreakdown items={receipt.items} onChange={(items) => setReceipt({ ...receipt, items })} mode="bill" onModeChange={setSaveMode} entryAmount={0} />
                {(() => {
                  const { items, total, bill } = billOf(receipt, receiptDraft)
                  return (
                    <SplitBill
                      items={items}
                      total={total}
                      bill={bill}
                      onChange={(next) => setReceipt({ ...receipt, bill: next })}
                      onFixItems={() => setSaveMode('one')}
                    />
                  )
                })()}
              </>
            ) : null}

            {receipt && receipt.mode === 'one' ? (
              <ReceiptBreakdown
                items={receipt.items}
                onChange={(items) => setReceipt({ ...receipt, items })}
                mode="one"
                onModeChange={setSaveMode}
                entryAmount={receiptDraft ? draftAmount(receiptDraft) : 0}
              />
            ) : null}

            <Button
              label={receipt?.mode === 'bill' ? 'Save the split' : pendingCount > 1 ? `Put all ${pendingCount} in` : 'Put it in the drawer'}
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

const EXAMPLES = ['kopi 18rb gopay', 'makan 25k kemarin', 'gaji 8jt bca']

/** One way in from paper: an icon box (orange for the main one), a label and a short hint. */
function ScanTile({
  icon,
  label,
  sub,
  onPress,
  primary,
}: {
  icon: IconName
  label: string
  sub: string
  onPress: () => void
  primary?: boolean
}) {
  const Colors = useColors()
  const styles = useStyles()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${sub}`}
      style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
    >
      <View style={[styles.tileIcon, primary && styles.tileIconPrimary]}>
        <Icon name={icon} size={22} color={primary ? Colors.onOrange : Colors.orangeDeep} />
      </View>
      <Text style={styles.tileLabel}>{label}</Text>
      <Text style={styles.tileSub} numberOfLines={1}>
        {sub}
      </Text>
    </Pressable>
  )
}

const useStyles = makeStyles((Colors) => ({
  fill: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  micArea: { alignItems: 'center', gap: 6, paddingVertical: 8 },
  micLabel: { fontSize: 18, fontFamily: Fonts.extrabold, color: Colors.charcoal, textAlign: 'center' },
  micHint: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18, color: Colors.secondaryGray, textAlign: 'center' },
  busyCard: { alignItems: 'center', gap: 8, paddingVertical: 28, paddingHorizontal: 20, borderRadius: 22, backgroundColor: Colors.cream },
  busyTitle: { fontSize: 18, fontFamily: Fonts.black, color: Colors.charcoal },
  busyHint: { fontSize: 14, fontFamily: Fonts.regular, color: Colors.secondaryGray, textAlign: 'center' },
  problem: { gap: 8 },
  cardHead: { gap: 2 },
  cardTitle: { fontSize: 17, fontFamily: Fonts.black, color: Colors.charcoal },
  cardSub: { fontSize: 13, fontFamily: Fonts.regular, color: Colors.secondaryGray },
  typeCard: { gap: 12, padding: 16, ...card(Colors) },
  typeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  typeInput: { flex: 1 },
  typeButton: { paddingHorizontal: 16 },
  examples: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  example: { paddingHorizontal: 10, height: 30, borderRadius: 10, justifyContent: 'center', backgroundColor: Colors.cream },
  exampleText: { fontSize: 13, fontFamily: Fonts.bold, color: Colors.inkSoft },
  scanBlock: { gap: 12 },
  tiles: { flexDirection: 'row', gap: 10 },
  tile: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 16, paddingHorizontal: 6, ...card(Colors), borderRadius: 18 },
  tilePressed: { backgroundColor: Colors.cream },
  tileIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    backgroundColor: Colors.orangeSoft,
  },
  tileIconPrimary: { backgroundColor: Colors.orange, borderWidth: 1.5, borderColor: Colors.ink, ...ledge(Colors.ink, 2) },
  tileLabel: { fontSize: 15, fontFamily: Fonts.black, color: Colors.charcoal },
  tileSub: { fontSize: 12, fontFamily: Fonts.semibold, color: Colors.secondaryGray },
  voiceSoon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: Colors.border,
  },
  voiceIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.orangeSoft },
  voiceText: { flex: 1, fontSize: 15, fontFamily: Fonts.bold, color: Colors.secondaryGray },
  soonBadge: { paddingHorizontal: 8, height: 22, borderRadius: 7, justifyContent: 'center', backgroundColor: Colors.inkCard },
  soonText: { fontSize: 11, fontFamily: Fonts.black, letterSpacing: 1.2, color: Colors.face },
  heardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, backgroundColor: Colors.cream },
  sourceIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.orangeSoft },
  receiptThumb: { width: 60, height: 80, borderRadius: 12, backgroundColor: Colors.surface },
  receiptOptions: { gap: 10, padding: 14, borderRadius: 18, borderWidth: 1.5, borderColor: Colors.borderLight, backgroundColor: Colors.surface },
  keepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  keepTitle: { fontSize: 14, fontFamily: Fonts.extrabold, color: Colors.charcoal },
  keepHint: { fontSize: 12, fontFamily: Fonts.semibold, color: Colors.secondaryGray },
  readToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 10, borderTopWidth: 1, borderTopColor: Colors.borderLight },
  readToggleText: { flex: 1, fontSize: 13, fontFamily: Fonts.extrabold, color: Colors.orangeDeep },
  readText: { fontSize: 12, lineHeight: 18, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), color: Colors.inkSoft, padding: 10, borderRadius: 10, backgroundColor: Colors.cream },
  pdfThumb: { alignItems: 'center', justifyContent: 'center', gap: 4, padding: 6, borderWidth: 1.5, borderColor: Colors.borderLight },
  pdfName: { fontFamily: Fonts.semibold, fontSize: 11, color: Colors.secondaryGray, textAlign: 'center' },
  sectionLabel: { fontSize: 12, fontFamily: Fonts.extrabold, color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8 },
  review: { gap: 14 },
  heard: { flex: 1, gap: 3 },
  transcript: { fontSize: 16, lineHeight: 22, fontFamily: Fonts.extrabold, color: Colors.charcoal },
}))
