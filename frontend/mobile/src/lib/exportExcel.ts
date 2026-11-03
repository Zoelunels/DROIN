import { Platform } from 'react-native'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { Endpoints } from '@/constants/api'
import { api } from '@/lib/api'
import { localDate } from '@/lib/display'
import type { TransactionType } from '@/types/api'

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export interface ExportFilters {
  type?: TransactionType
  q?: string
  from?: string
  to?: string
}

/**
 * Downloads transactions as an Excel file and hands it to the phone's share sheet (save to Files,
 * open in Excel/Sheets, send on WhatsApp…). On web the browser downloads it instead.
 * Throws ApiError (offline, 401, …) like any other API call.
 */
export async function exportToExcel(filters: ExportFilters = {}): Promise<'shared' | 'downloaded'> {
  const bytes = await api.download(Endpoints.exportXlsx, {
    type: filters.type,
    q: filters.q || undefined,
    from: filters.from,
    to: filters.to,
  })
  const name = `droin-transactions-${localDate(0)}.xlsx`

  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: XLSX_TYPE }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    return 'downloaded'
  }

  const file = new File(Paths.cache, name)
  if (file.exists) file.delete() // re-exporting the same day replaces the old file
  file.create()
  file.write(bytes)

  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.')
  await Sharing.shareAsync(file.uri, {
    mimeType: XLSX_TYPE,
    UTI: 'org.openxmlformats.spreadsheetml.sheet',
    dialogTitle: 'Export to Excel',
  })
  return 'shared'
}
