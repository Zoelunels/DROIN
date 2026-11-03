import React, { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native'
import { Icon } from '@/components/ui/Icon'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ReceiptImage, forgetReceipt } from '@/components/ReceiptImage'
import { Button } from '@/components/ui/Button'
import { Endpoints } from '@/constants/api'
import { Fonts, makeStyles, useColors } from '@/constants/colors'
import { ApiError, api } from '@/lib/api'
import { attachReceipt, pickInvoicePdf, pickReceiptPhoto, type Attachment } from '@/lib/receipt'
import { notify } from '@/lib/toast'

const errorText = (err: unknown) =>
  err instanceof ApiError ? (err.offline ? "Can't reach the drawer." : err.message) : 'The drawer jammed. Try again?'

/** Receipt photos on a saved entry: thumbnails, a full-screen viewer with delete, and add (camera/gallery). */
export function ReceiptSection({
  transactionId,
  confirm,
}: {
  transactionId: number
  confirm: (title: string, message: string, action: string) => Promise<boolean>
}) {
  const Colors = useColors()
  const styles = useStyles()
  const insets = useSafeAreaInsets()
  const [items, setItems] = useState<Attachment[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [viewing, setViewing] = useState<Attachment | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = useCallback(async () => {
    try {
      setItems(await api.get<Attachment[]>(`${Endpoints.transactions}/${transactionId}/attachments`))
    } catch {
      setItems([])
    }
  }, [transactionId])

  useEffect(() => {
    load()
  }, [load])

  async function add(from: 'camera' | 'library' | 'pdf') {
    const picked = await (from === 'pdf' ? pickInvoicePdf() : pickReceiptPhoto(from)).catch(() => 'canceled' as const)
    if (picked === 'canceled') return
    if (picked === 'denied') {
      notify.error('No camera access.', 'Allow it in Settings, or pick from the gallery.', 'camera')
      return
    }
    if (picked === 'too-big') {
      notify.error('That PDF is over 5 MB.', undefined, 'document')
      return
    }
    setAdding(true)
    try {
      const created = await attachReceipt(transactionId, picked)
      setItems((prev) => [...(prev ?? []), created])
      notify.saved('Receipt')
    } catch (err) {
      notify.error(errorText(err), undefined, 'receipt')
    } finally {
      setAdding(false)
    }
  }

  async function remove(item: Attachment) {
    const ok = await confirm('Delete this receipt photo?', 'The entry stays; only the photo goes.', 'Delete photo')
    if (!ok) return
    setDeleting(true)
    try {
      await api.delete(`/attachments/${item.id}`)
      forgetReceipt(item.id)
      setItems((prev) => (prev ?? []).filter((a) => a.id !== item.id))
      setViewing(null)
    } catch (err) {
      notify.error(errorText(err))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Receipt</Text>
      {items === null ? (
        <ActivityIndicator color={Colors.orange} style={styles.spinner} />
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {items.map((a) =>
            a.mime_type.startsWith('image/') ? (
              <Pressable key={a.id} onPress={() => setViewing(a)} accessibilityRole="button" accessibilityLabel="Open receipt photo">
                <ReceiptImage id={a.id} style={styles.thumb} />
              </Pressable>
            ) : (
              <View key={a.id} style={[styles.thumb, styles.fileTile]}>
                <Icon name="document" size={26} color={Colors.secondaryGray} />
                <Text style={styles.fileName} numberOfLines={2}>
                  {a.original_name}
                </Text>
              </View>
            ),
          )}
          {adding ? (
            <View style={[styles.thumb, styles.fileTile]}>
              <ActivityIndicator color={Colors.orange} />
            </View>
          ) : null}
        </ScrollView>
      )}
      <View style={styles.buttons}>
        <Button variant="secondary" size="sm" icon="camera" label="Take photo" onPress={() => add('camera')} disabled={adding} style={styles.flex} />
        <Button variant="secondary" size="sm" icon="gallery" label="Gallery" onPress={() => add('library')} disabled={adding} style={styles.flex} />
        <Button variant="secondary" size="sm" icon="document" label="PDF" onPress={() => add('pdf')} disabled={adding} style={styles.flex} />
      </View>

      <Modal visible={!!viewing} transparent animationType="fade" onRequestClose={() => setViewing(null)} statusBarTranslucent>
        <View style={[styles.viewer, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.viewerBar}>
            <Pressable onPress={() => setViewing(null)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Icon name="close" size={28} color={Colors.onColor} />
            </Pressable>
            {viewing ? (
              <Pressable onPress={() => remove(viewing)} hitSlop={12} accessibilityRole="button" accessibilityLabel="Delete photo">
                {deleting ? <ActivityIndicator color={Colors.onColor} /> : <Icon name="trash" size={24} color={Colors.onColor} />}
              </Pressable>
            ) : null}
          </View>
          {viewing ? <ReceiptImage id={viewing.id} style={styles.full} contain /> : null}
        </View>
      </Modal>
    </View>
  )
}

const useStyles = makeStyles((Colors) => ({
  wrap: { gap: 8 },
  label: { fontSize: 13, fontFamily: Fonts.semibold, color: Colors.secondaryGray },
  spinner: { alignSelf: 'flex-start', marginVertical: 8 },
  row: { gap: 8 },
  thumb: { width: 72, height: 96, borderRadius: 10, backgroundColor: Colors.cream },
  fileTile: { alignItems: 'center', justifyContent: 'center', gap: 4, padding: 6, borderWidth: 1.5, borderColor: Colors.borderLight },
  fileName: { fontFamily: Fonts.regular, fontSize: 11, color: Colors.secondaryGray, textAlign: 'center' },
  buttons: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
  viewer: { flex: 1, backgroundColor: 'rgba(20,19,18,0.96)', paddingHorizontal: 16, gap: 12 },
  viewerBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: 44 },
  full: { flex: 1, width: '100%', backgroundColor: 'transparent' },
}))
