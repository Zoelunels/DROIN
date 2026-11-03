import { isIconName, type IconName } from '@/components/ui/Icon'
import type { Transaction, WalletType } from '@/types/api'

/** Icons offered when picking one for a category: food, transport, home, bills, shopping, people, fun, work, money. */
export const CATEGORY_ICON_CHOICES: IconName[] = [
  'utensils', 'coffee', 'sandwich', 'cake', 'drink', 'beer', 'basket', 'cart',
  'bus', 'car', 'motorbike', 'bike', 'fuel', 'train', 'plane', 'parking',
  'home', 'sofa', 'bolt', 'droplet', 'wifi', 'phone', 'receipt', 'wrench',
  'shopping-bag', 'shirt', 'gem', 'scissors', 'brush', 'heart', 'pill', 'hospital',
  'dumbbell', 'film', 'tv', 'game', 'music', 'book', 'graduation', 'luggage',
  'paw', 'baby', 'people', 'gift', 'hand-heart', 'briefcase', 'store', 'chart',
  'cash', 'piggy-bank', 'bank', 'card', 'shield', 'calculator', 'star', 'tag',
]

// Categories made before DROIN dropped emoji may still have one saved as their icon.
const FROM_EMOJI: Record<string, IconName> = {
  '🍜': 'utensils', '🍽️': 'utensils', '☕': 'coffee', '🍔': 'sandwich', '🛒': 'cart', '🥦': 'basket', '🍰': 'cake',
  '🍺': 'beer', '🧋': 'drink', '🚗': 'car', '🛵': 'motorbike', '⛽': 'fuel', '🚌': 'bus', '✈️': 'plane',
  '🅿️': 'parking', '🏠': 'home', '💡': 'bolt', '💧': 'droplet', '📱': 'phone', '🌐': 'wifi', '🧾': 'receipt',
  '👕': 'shirt', '👟': 'shirt', '💄': 'brush', '🛍️': 'shopping-bag', '💊': 'pill', '🏥': 'hospital',
  '🏋️': 'dumbbell', '🎬': 'film', '🎮': 'game', '🎵': 'music', '📚': 'book', '🎓': 'graduation', '🐶': 'paw',
  '🐾': 'paw', '👶': 'baby', '🧸': 'baby', '🎁': 'gift', '🙏': 'hand-heart', '💼': 'briefcase', '💰': 'cash',
  '💵': 'cash', '📈': 'chart', '🏦': 'bank', '💳': 'card', '🔧': 'wrench', '✂️': 'scissors', '🧹': 'brush',
  '🧳': 'luggage', '🏷️': 'tag', '⭐': 'star', '💻': 'briefcase', '🛡️': 'shield', '🧮': 'calculator',
  '🔁': 'transfer', '🛋️': 'sofa', '🐷': 'piggy-bank', '📖': 'book',
}

// A category without an icon of its own gets one from its name (English and Bahasa).
const BY_NAME: [RegExp, IconName][] = [
  [/salary|gaji|payroll|upah|wage/, 'briefcase'],
  [/bonus|thr|reward/, 'star'],
  [/freelance|project|side|hustle|business|usaha|bisnis/, 'store'],
  [/invest|saham|stock|dividend|reksa/, 'chart'],
  [/interest|bunga/, 'bank'],
  [/coffee|kopi|cafe/, 'coffee'],
  [/food|makan|drink|minum|resto|restaurant|snack/, 'utensils'],
  [/grocer|market|belanja|supermarket|pasar/, 'basket'],
  [/fuel|bensin|petrol|pertamina|spbu/, 'fuel'],
  [/transport|commute|gojek|grab|ojek|bus|train|kereta|taxi|parkir|parking/, 'bus'],
  [/electric|listrik|pln/, 'bolt'],
  [/water|pdam|\bair\b/, 'droplet'],
  [/internet|wifi|indihome/, 'wifi'],
  [/phone|pulsa|data|paket/, 'phone'],
  [/bill|tagihan|utility/, 'receipt'],
  [/rent|sewa|housing|kpr|mortgage|kos/, 'home'],
  [/health|doctor|dokter|obat|medicine|medical|dental|hospital|rumah sakit/, 'pill'],
  [/gym|sport|olahraga|fitness/, 'dumbbell'],
  [/education|school|sekolah|course|kursus|tuition|kuliah/, 'graduation'],
  [/book|buku/, 'book'],
  [/cloth|fashion|baju|shoes|sepatu/, 'shirt'],
  [/shop|belanja online|tokopedia|shopee/, 'shopping-bag'],
  [/movie|film|bioskop|netflix|subscription|langganan|stream/, 'film'],
  [/game/, 'game'],
  [/music|spotify|musik/, 'music'],
  [/entertain|hiburan|fun/, 'film'],
  [/gift|hadiah|present/, 'gift'],
  [/donation|donasi|charity|zakat|infaq|sedekah/, 'hand-heart'],
  [/travel|holiday|vacation|liburan|trip|flight|hotel/, 'plane'],
  [/pet|animal|cat|dog|kucing|anjing/, 'paw'],
  [/beauty|salon|skincare|haircut|potong rambut/, 'brush'],
  [/insurance|asuransi/, 'shield'],
  [/tax|pajak|fee|admin|charge|penalty|denda/, 'calculator'],
  [/transfer|topup|top up|withdraw|tarik/, 'transfer'],
  [/child|kid|baby|anak/, 'baby'],
  [/family|keluarga|friend|teman/, 'people'],
  [/car|mobil|motor|vehicle|bike|service|bengkel/, 'car'],
  [/household|furniture|perabot|home/, 'sofa'],
  [/saving|tabung|deposit|emergency/, 'piggy-bank'],
  [/opening|balance|saldo/, 'wallet'],
]

/** The icon for a category: its own (a name, or an old emoji translated), else one matched from its name. */
export function categoryIconName(c: { name?: string | null; icon?: string | null }): IconName {
  if (isIconName(c.icon)) return c.icon
  if (c.icon && FROM_EMOJI[c.icon]) return FROM_EMOJI[c.icon]!
  const n = (c.name ?? '').toLowerCase()
  for (const [re, icon] of BY_NAME) if (re.test(n)) return icon
  return 'tag'
}

/** The icon for a wallet: its own, else from its name (BCA → bank, GoPay → phone), else its type. */
export function walletIconName(w: { name?: string | null; wallet_type?: WalletType; icon?: string | null }): IconName {
  if (isIconName(w.icon)) return w.icon
  if (w.icon && FROM_EMOJI[w.icon]) return FROM_EMOJI[w.icon]!
  const n = (w.name ?? '').toLowerCase()
  if (/cash|tunai|dompet/.test(n)) return 'cash'
  if (/credit|kartu kredit|\bcc\b/.test(n)) return 'card'
  if (/ovo|gopay|dana|shopeepay|linkaja|paypal|e-?wallet/.test(n)) return 'phone'
  if (/bank|bca|bni|mandiri|bri|bsi|permata|danamon|cimb|jenius|jago|seabank|blu/.test(n)) return 'bank'
  if (/saving|tabung|deposit/.test(n)) return 'piggy-bank'
  if (/invest|stock|reksa|saham/.test(n)) return 'chart'
  return WALLET_TYPE_ICON[w.wallet_type ?? 'other']
}

export const WALLET_TYPE_ICON: Record<WalletType, IconName> = {
  cash: 'cash',
  bank: 'bank',
  ewallet: 'phone',
  savings: 'piggy-bank',
  other: 'wallet',
}

/** The icon for a transaction row: transfers and debts have their own, entries use their category's. */
export function transactionIconName(t: Pick<Transaction, 'origin' | 'category_name' | 'category_icon'>): IconName {
  if (t.origin === 'transfer') return 'transfer'
  if (t.origin === 'transfer_fee') return 'receipt'
  if (t.origin === 'debt') return 'debt'
  return categoryIconName({ name: t.category_name, icon: t.category_icon })
}
