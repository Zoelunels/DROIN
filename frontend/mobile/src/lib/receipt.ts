import { Platform } from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { File as FSFile } from 'expo-file-system'
import * as ImagePicker from 'expo-image-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { API_BASE_URL, Endpoints } from '@/constants/api'
import { api } from '@/lib/api'
import type { QuickDraft } from '@/types/api'

/** POST /quick-input/receipt */
export interface ReceiptScan {
  kind: 'receipt' | 'invoice'
  text: string
  merchant: string | null
  total: number | null
  date: string | null
  payment: string | null
  /** What was bought, line by line (empty when the receipt lists none). */
  items: { name: string; amount: number }[]
  draft: QuickDraft
}

/** GET /transactions/:id/attachments */
export interface Attachment {
  id: number
  transaction_id: number
  original_name: string
  mime_type: string
  size_bytes: number
  created_at: string
}

/** A picked receipt photo (always JPEG) or invoice PDF, still on this device. */
export interface ReceiptFile {
  uri: string
  name: string
  type: 'image/jpeg' | 'application/pdf'
}

export type PickResult = ReceiptFile | 'canceled' | 'denied'

/** The server reads files up to 5 MB (POST /quick-input/receipt). */
export const MAX_RECEIPT_BYTES = 5 * 1024 * 1024

// Receipts only need to be readable: ~1600 px wide JPEG is sharp enough for OCR and ~300 KB to upload,
// instead of a 4–8 MB camera original.
const MAX_WIDTH = 1600

/** Camera or gallery. Asks for camera permission when needed; the gallery needs none. */
export async function pickReceiptPhoto(source: 'camera' | 'library'): Promise<PickResult> {
  if (source === 'camera' && Platform.OS !== 'web') {
    const perm = await ImagePicker.requestCameraPermissionsAsync()
    if (!perm.granted) return 'denied'
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 }
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options)
  const asset = result.canceled ? null : result.assets?.[0]
  if (!asset) return 'canceled'

  // Shrink big photos (and turn HEIC/PNG into JPEG, which the server and OCR both read).
  const context = ImageManipulator.manipulate(asset.uri)
  if (asset.width > MAX_WIDTH) context.resize({ width: MAX_WIDTH })
  const rendered = await context.renderAsync()
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 })
  return { uri: saved.uri, name: 'struk.jpg', type: 'image/jpeg' }
}

/** An invoice PDF from Files / Downloads / Drive (e-invoices, PLN or marketplace bills). */
export async function pickInvoicePdf(): Promise<ReceiptFile | 'canceled' | 'too-big'> {
  const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true })
  const asset = result.canceled ? null : result.assets?.[0]
  if (!asset) return 'canceled'
  if (asset.size && asset.size > MAX_RECEIPT_BYTES) return 'too-big'
  return { uri: asset.uri, name: asset.name || 'invoice.pdf', type: 'application/pdf' }
}

/**
 * A multipart file field. Since SDK 58 the app's fetch is Expo's, which no longer takes React
 * Native's `{ uri, name, type }` objects (it throws before sending, which looked like "offline").
 * Native sends an expo-file-system File (a real Blob read from disk); web fetches the blob URL.
 */
export async function fileField(uri: string): Promise<Blob> {
  if (Platform.OS === 'web') return (await fetch(uri)).blob()
  return new FSFile(uri)
}

/** Sends the photo or PDF to the server, which reads it and returns a draft. Nothing is saved. */
export async function scanReceipt(file: ReceiptFile): Promise<ReceiptScan> {
  const form = new FormData()
  form.append('image', await fileField(file.uri), file.name)
  return api.upload<ReceiptScan>(Endpoints.quickInputReceipt, form, 60_000)
}

/** Keeps the photo or PDF with a saved entry. */
export async function attachReceipt(transactionId: number, file: ReceiptFile): Promise<Attachment> {
  const form = new FormData()
  form.append('file', await fileField(file.uri), file.name)
  return api.upload<Attachment>(`${Endpoints.transactions}/${transactionId}/attachments`, form)
}

/** Where a stored receipt can be loaded from (the request needs the login token). */
export const attachmentUrl = (id: number) => `${API_BASE_URL}/attachments/${id}`
