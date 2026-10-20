import type { TransactionType, WalletType } from '@/types/api'

/** Pick a friendly emoji for a category based on its name. */
export function categoryEmoji(name?: string | null): string {
  if (!name) return '🏷️'
  const n = name.toLowerCase()

  const map: Array<[RegExp, string]> = [
    [/salary|gaji|payroll|upah|wage/, '💼'],
    [/bonus|thr|reward/, '🎁'],
    [/freelance|project|side|hustle/, '💻'],
    [/invest|saham|stock|dividend|reksa/, '📈'],
    [/interest|bunga/, '🏦'],
    [/food|makan|drink|minum|resto|restaurant|cafe|coffee|kopi|snack/, '🍜'],
    [/grocer|market|belanja|supermarket|pasar/, '🛒'],
    [/transport|commute|gojek|grab|ojek|fuel|bensin|petrol|bus|train|kereta/, '🚗'],
    [/bill|tagihan|electric|listrik|water|air|internet|wifi|phone|pulsa|utility/, '🧾'],
    [/rent|sewa|housing|kpr|mortgage/, '🏠'],
    [/health|doctor|obat|medicine|gym|medical|dental/, '💊'],
    [/education|school|sekolah|course|book|buku|tuition/, '📚'],
    [/cloth|fashion|baju|shoes|sepatu/, '👕'],
    [/entertain|movie|film|game|music|spotify|netflix|subscription|langganan/, '🎬'],
    [/gift|hadiah|present|donation|donasi|charity|zakat|infaq/, '🎁'],
    [/travel|holiday|vacation|liburan|trip|flight|hotel/, '✈️'],
    [/pet|animal|cat|dog/, '🐾'],
    [/beauty|salon|skincare|haircut/, '💄'],
    [/insurance|asuransi|tax|pajak/, '🛡️'],
    [/fee|admin|charge|penalty/, '🧮'],
    [/transfer|topup|top up|withdraw|tarik/, '🔁'],
    [/child|kid|baby|anak/, '🧸'],
    [/car|motor|vehicle|bike|service/, '🛵'],
    [/home|household|furniture|perabot/, '🛋️'],
    [/saving|tabung|deposit|emergency/, '🐷'],
    [/opening|balance|saldo/, '📖'],
  ]

  for (const [re, emoji] of map) {
    if (re.test(n)) return emoji
  }
  return '🏷️'
}

/** Emoji for a wallet, based on its type and name. */
export function walletEmoji(name?: string | null, type?: WalletType): string {
  const n = (name || '').toLowerCase()
  if (/cash|tunai|dompet/.test(n)) return '👛'
  if (/bank|bca|bni|mandiri|bri|bsi|permata|danamon|cimb|jenius/.test(n)) return '🏦'
  if (/ovo|gopay|dana|shopeepay|linkaja|paypal|wallet|e-?wallet/.test(n)) return '📱'
  if (/saving|tabung|deposit/.test(n)) return '🐷'
  if (/invest|stock|reksa|saham/.test(n)) return '📈'
  if (/credit|card|kartu/.test(n)) return '💳'

  switch (type) {
    case 'cash':
      return '👛'
    case 'bank':
      return '🏦'
    case 'ewallet':
      return '📱'
    case 'savings':
      return '🐷'
    default:
      return '💼'
  }
}

/** Emoji for a budget category line. */
export function typeEmoji(type: TransactionType): string {
  return type === 'income' ? '💚' : '🧡'
}

/** A friendly greeting that changes with the time of day. */
export function greeting(date = new Date()): string {
  const h = date.getHours()
  if (h < 11) return 'Good morning'
  if (h < 15) return 'Good afternoon'
  if (h < 19) return 'Good evening'
  return 'Good night'
}

/** A random encouraging line, used around the mascot. */
const CHEERS = [
  'Every entry counts! ✨',
  'Nice, keep the book tidy! 📖',
  'Small steps, big drawer! 🗄️',
  'You got this! 💪',
  'Money likes a habit. 🌱',
  'Looking good today! 🧡',
  'One more page! 📄',
]

export function cheer(seed = Date.now()): string {
  return CHEERS[Math.floor(seed) % CHEERS.length]
}
