import React, { useEffect, useMemo, useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Icon, type IconName } from '@/components/ui/Icon'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { IconPicker } from '@/components/IconPicker'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { TYPE_LABEL } from '@/components/ui/TypeToggle'
import { Endpoints } from '@/constants/api'
import { Fonts, makeStyles, useColors } from '@/constants/colors'
import { ApiError, api } from '@/lib/api'
import { categoryIconName } from '@/lib/icons'
import type { Category, TransactionType } from '@/types/api'

/**
 * Bottom-sheet category picker: search, every visible category of the given type as a tile grid,
 * and "New category" right inside it (name + icon), so nobody has to leave the form.
 */
export function CategoryPicker({
  visible,
  type,
  categories,
  selectedId,
  onSelect,
  onCreated,
  onClose,
}: {
  visible: boolean
  type: TransactionType
  categories: Category[]
  selectedId: number | null
  onSelect: (category: Category) => void
  onCreated: (category: Category) => void
  onClose: () => void
}) {
  const Colors = useColors()
  const styles = useStyles()
  const insets = useSafeAreaInsets()
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState<IconName | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Start fresh every time the sheet opens.
  useEffect(() => {
    if (visible) {
      setSearch('')
      setCreating(false)
      setError(null)
    }
  }, [visible])

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    return categories
      .filter((c) => c.type === type && !c.system_key && !c.archived_at)
      .filter((c) => q === '' || c.name.toLowerCase().includes(q))
  }, [categories, type, search])

  function startCreate() {
    setName(search.trim())
    setIcon(null)
    setError(null)
    setCreating(true)
  }

  async function create() {
    if (!name.trim()) {
      setError('Give it a name.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const created = await api.post<Category>(Endpoints.categories, { name: name.trim(), type, icon })
      onCreated(created)
      onSelect(created)
      onClose()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The drawer jammed. Try again?')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />
          <View style={styles.head}>
            <Text style={styles.title}>{creating ? `New ${TYPE_LABEL[type]} category` : `${TYPE_LABEL[type]} categories`}</Text>
            <Pressable onPress={creating ? () => setCreating(false) : onClose} hitSlop={10} accessibilityRole="button">
              <Text style={styles.headAction}>{creating ? 'Back' : 'Close'}</Text>
            </Pressable>
          </View>

          {creating ? (
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.createBody}>
              <Input label="Name" value={name} onChangeText={setName} placeholder="Kos, Ngopi, Kucing…" autoFocus error={error ?? undefined} />
              <Text style={styles.label}>Icon</Text>
              <IconPicker value={icon} onChange={setIcon} />
              <Button label="Add category" onPress={create} loading={saving} full size="lg" />
            </ScrollView>
          ) : (
            <>
              <Input icon="search" value={search} onChangeText={setSearch} placeholder="Search categories" autoCorrect={false} />
              <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.grid}>
                {list.map((c) => {
                  const on = c.id === selectedId
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => {
                        onSelect(c)
                        onClose()
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      style={({ pressed }) => [
                        styles.tile,
                        { borderColor: on ? Colors.orange : Colors.borderLight, backgroundColor: on || pressed ? Colors.orangeSoft : Colors.surface },
                      ]}
                    >
                      <Icon name={categoryIconName(c)} size={24} color={Colors.charcoal} />
                      <Text style={styles.tileName} numberOfLines={2}>
                        {c.name}
                      </Text>
                    </Pressable>
                  )
                })}
                <Pressable
                  onPress={startCreate}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.tile, styles.newTile, pressed && { backgroundColor: Colors.cream }]}
                >
                  <Icon name="add" size={24} color={Colors.orange} />
                  <Text style={[styles.tileName, { color: Colors.orangeDeep }]} numberOfLines={2}>
                    {search.trim() ? `Add "${search.trim()}"` : 'New category'}
                  </Text>
                </Pressable>
              </ScrollView>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  )
}

/** The form field: shows the picked category (or a prompt) and opens the picker on tap. */
export function CategoryField({
  category,
  hint,
  onPress,
}: {
  category: Category | null
  hint?: string | null
  onPress: () => void
}) {
  const Colors = useColors()
  const styles = useStyles()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={category ? `Category: ${category.name}. Change` : 'Pick a category'}
      style={({ pressed }) => [styles.field, { borderColor: hint ? Colors.orange : Colors.borderLight, backgroundColor: pressed ? Colors.cream : Colors.surface }]}
    >
      <Icon name={category ? categoryIconName(category) : 'tag'} size={20} color={category ? Colors.charcoal : Colors.secondaryGray} />
      <Text style={[styles.fieldText, !category && { color: Colors.secondaryGray }]} numberOfLines={1}>
        {category ? category.name : 'Pick a category'}
      </Text>
      <Icon name="chevron-down" size={18} color={Colors.secondaryGray} />
    </Pressable>
  )
}

const useStyles = makeStyles((Colors) => ({
  fill: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: Colors.backdrop },
  sheet: {
    maxHeight: '82%',
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
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontFamily: Fonts.extrabold, color: Colors.charcoal },
  headAction: { fontSize: 15, fontFamily: Fonts.bold, color: Colors.secondaryGray },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 8 },
  tile: {
    width: '31.5%',
    minHeight: 78,
    padding: 8,
    gap: 4,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newTile: { borderStyle: 'dashed', borderColor: Colors.borderLight, backgroundColor: 'transparent' },
  tileName: { fontSize: 12, fontFamily: Fonts.semibold, color: Colors.charcoal, textAlign: 'center' },
  createBody: { gap: 12, paddingBottom: 8 },
  label: { fontSize: 13, fontFamily: Fonts.semibold, color: Colors.charcoal },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 50,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  fieldText: { flex: 1, fontSize: 16, fontFamily: Fonts.semibold, color: Colors.charcoal },
}))
