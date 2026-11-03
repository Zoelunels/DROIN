import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Redirect, router } from 'expo-router'
import { Icon, IconTile, type IconName } from '@/components/ui/Icon'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { IconPicker } from '@/components/IconPicker'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Screen } from '@/components/ui/Screen'
import { Banner } from '@/components/ui/States'
import { TYPE_LABEL, TypeToggle } from '@/components/ui/TypeToggle'
import { Endpoints } from '@/constants/api'
import { Fonts, makeStyles, useColors } from '@/constants/colors'
import { useScreenData } from '@/hooks/useScreenData'
import { ApiError, api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { categoryIconName } from '@/lib/icons'
import { notify } from '@/lib/toast'
import type { Category, TransactionType } from '@/types/api'

const errorText = (err: unknown) =>
  err instanceof ApiError ? (err.offline ? "Can't reach the drawer. Check your connection." : err.message) : 'The drawer jammed. Try again?'

type Editing = { mode: 'new'; type: TransactionType } | { mode: 'edit'; category: Category }

/** Add, rename, re-icon and hide categories. Hidden ones keep their history and can come back. */
export default function Categories() {
  const Colors = useColors()
  const styles = useStyles()
  const { isAuthenticated, isLoading } = useAuth()
  const [type, setType] = useState<TransactionType>('expense')
  const [editing, setEditing] = useState<Editing | null>(null)
  const [showHidden, setShowHidden] = useState(false)

  const load = useCallback(
    () => api.get<Category[]>(Endpoints.categories, { include_archived: true }).then((all) => all.filter((c) => !c.system_key)),
    [],
  )
  const { data, error, refreshing, refresh, reload } = useScreenData(load)

  if (!isLoading && !isAuthenticated) return <Redirect href="/login" />

  const ofType = (data ?? []).filter((c) => c.type === type)
  const active = ofType.filter((c) => !c.archived_at)
  const hidden = ofType.filter((c) => c.archived_at)

  return (
    <>
      <Screen
        bottomSpace={32}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.orange} colors={[Colors.orange]} />}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" style={styles.headerButton}>
            <Icon name="back" size={24} color={Colors.charcoal} />
          </Pressable>
          <Text style={styles.headerTitle}>Categories</Text>
          <View style={styles.headerButton} />
        </View>

        <TypeToggle value={type} onChange={setType} />

        {error && !data ? (
          <View style={styles.gap}>
            <Banner icon="offline" tone="expense" text={errorText(error)} />
            <Button variant="secondary" label="Try again" onPress={reload} />
          </View>
        ) : !data ? (
          <ActivityIndicator color={Colors.orange} style={styles.spinner} />
        ) : (
          <>
            <View style={styles.card}>
              {active.map((c, i) => (
                <Row key={c.id} category={c} last={i === active.length - 1} onPress={() => setEditing({ mode: 'edit', category: c })} />
              ))}
              {active.length === 0 ? <Text style={styles.empty}>No {TYPE_LABEL[type]} categories yet.</Text> : null}
            </View>

            <Button variant="secondary" label={`New ${TYPE_LABEL[type]} category`} onPress={() => setEditing({ mode: 'new', type })} full />

            {hidden.length > 0 ? (
              <View style={styles.gap}>
                <Pressable onPress={() => setShowHidden((s) => !s)} accessibilityRole="button" style={styles.hiddenToggle}>
                  <Text style={styles.hiddenLabel}>Hidden ({hidden.length})</Text>
                  <Icon name={showHidden ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.secondaryGray} />
                </Pressable>
                {showHidden ? (
                  <View style={[styles.card, styles.hiddenCard]}>
                    {hidden.map((c, i) => (
                      <Row key={c.id} category={c} last={i === hidden.length - 1} onPress={() => setEditing({ mode: 'edit', category: c })} />
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            <Text style={styles.footnote}>Hiding a category only removes it from the pickers. Entries that use it keep it.</Text>
          </>
        )}
      </Screen>

      <CategoryEditor
        editing={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null)
          reload()
        }}
      />
    </>
  )
}

function Row({ category, last, onPress }: { category: Category; last: boolean; onPress: () => void }) {
  const Colors = useColors()
  const styles = useStyles()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityHint="Rename, change the icon, or hide"
      style={({ pressed }) => [styles.row, !last && styles.divider, { opacity: pressed ? 0.55 : 1 }]}
    >
      <IconTile name={categoryIconName(category)} size={40} bg={Colors.cream} color={Colors.charcoal} />
      <Text style={styles.rowName} numberOfLines={1}>
        {category.name}
      </Text>
      <Icon name="chevron-right" size={18} color={Colors.secondaryGray} />
    </Pressable>
  )
}

/** Bottom sheet for a new category or editing one: name, icon, and hide/unhide. */
function CategoryEditor({ editing, onClose, onSaved }: { editing: Editing | null; onClose: () => void; onSaved: () => void }) {
  const styles = useStyles()
  const insets = useSafeAreaInsets()
  const [name, setName] = useState('')
  const [icon, setIcon] = useState<IconName | null>(null)
  const [busy, setBusy] = useState<'save' | 'hide' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const category = editing?.mode === 'edit' ? editing.category : null
  const type = editing?.mode === 'edit' ? editing.category.type : editing?.type ?? 'expense'

  useEffect(() => {
    if (!editing) return
    setName(category?.name ?? '')
    setIcon(category ? categoryIconName(category) : null)
    setError(null)
    setBusy(null)
  }, [editing, category])

  async function save() {
    if (!name.trim()) {
      setError('Give it a name.')
      return
    }
    setBusy('save')
    setError(null)
    try {
      const body = { name: name.trim(), type, icon, color: category?.color ?? null }
      if (category) await api.put(`${Endpoints.categories}/${category.id}`, body)
      else await api.post(Endpoints.categories, body)
      notify.saved(category ? 'Category' : 'New category')
      onSaved()
    } catch (err) {
      setError(errorText(err))
      setBusy(null)
    }
  }

  async function toggleHidden() {
    if (!category) return
    setBusy('hide')
    try {
      await api.post(`${Endpoints.categories}/${category.id}/${category.archived_at ? 'unarchive' : 'archive'}`)
      notify.info(category.archived_at ? `${category.name} is back.` : `${category.name} is hidden.`, undefined, category.archived_at ? 'eye' : 'eye-off')
      onSaved()
    } catch (err) {
      setError(errorText(err))
      setBusy(null)
    }
  }

  return (
    <Modal visible={!!editing} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.sheetWrap} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>{category ? 'Edit category' : `New ${TYPE_LABEL[type]} category`}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
              <Text style={styles.sheetClose}>Close</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>
            <Input label="Name" value={name} onChangeText={setName} placeholder="Kos, Ngopi, Kucing…" error={error ?? undefined} />
            <Text style={styles.label}>Icon</Text>
            <IconPicker value={icon} onChange={setIcon} />
            <Button label={category ? 'Save' : 'Add category'} onPress={save} loading={busy === 'save'} disabled={busy === 'hide'} size="lg" full />
            {category ? (
              <Button
                variant="ghost"
                label={category.archived_at ? 'Show it again' : 'Hide this category'}
                onPress={toggleHidden}
                loading={busy === 'hide'}
                disabled={busy === 'save'}
                full
              />
            ) : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

const useStyles = makeStyles((Colors) => ({
  gap: { gap: 8 },
  spinner: { marginTop: 32 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontFamily: Fonts.extrabold, color: Colors.charcoal },
  card: {
    paddingHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surface,
  },
  hiddenCard: { opacity: 0.75 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.borderLight },
  rowName: { flex: 1, fontSize: 15, fontFamily: Fonts.semibold, color: Colors.charcoal },
  empty: { fontFamily: Fonts.regular, paddingVertical: 16, fontSize: 14, color: Colors.secondaryGray, textAlign: 'center' },
  hiddenToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  hiddenLabel: { fontSize: 13, fontFamily: Fonts.bold, color: Colors.secondaryGray, textTransform: 'uppercase', letterSpacing: 0.6 },
  footnote: { fontFamily: Fonts.regular, fontSize: 13, lineHeight: 18, color: Colors.secondaryGray },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: Colors.backdrop },
  sheet: {
    maxHeight: '85%',
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    gap: 12,
    paddingTop: 8,
    paddingHorizontal: 20,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: Colors.background,
  },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.borderLight, marginBottom: 4 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 18, fontFamily: Fonts.extrabold, color: Colors.charcoal },
  sheetClose: { fontSize: 15, fontFamily: Fonts.bold, color: Colors.secondaryGray },
  sheetBody: { gap: 12, paddingBottom: 8 },
  label: { fontSize: 13, fontFamily: Fonts.semibold, color: Colors.charcoal },
}))
