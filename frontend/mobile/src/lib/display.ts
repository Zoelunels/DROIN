// Small display helpers shared by the tab screens. Plain string work (no Intl), so Hermes on
// older Android phones formats exactly like the web preview.

/** 25000 → "Rp 25.000", -1500 → "-Rp 1.500" */
export function money(amount: number, { sign = false }: { sign?: boolean } = {}): string {
  const rounded = Math.round(Math.abs(amount))
  const grouped = String(rounded).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const prefix = amount < 0 ? '-' : sign && amount > 0 ? '+' : ''
  return `${prefix}Rp ${grouped}`
}

/** 1_250_000 → "1,3 jt", 25_000 → "25 rb" — for tight spaces like wallet cards. */
export function moneyShort(amount: number): string {
  const abs = Math.abs(amount)
  const sign = amount < 0 ? '-' : ''
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(1).replace('.', ',').replace(',0', '')} M`
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1).replace('.', ',').replace(',0', '')} jt`
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)} rb`
  return `${sign}${Math.round(abs)}`
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Local calendar date, offset by whole days: localDate(-1) = yesterday as "YYYY-MM-DD". */
export function localDate(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const thisMonth = () => localDate(0).slice(0, 7)

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "2026-10-20" → "Today" / "Yesterday" / "Sat, 17 Oct" (adds the year when it isn't this year). */
export function dayLabel(date: string): string {
  if (date === localDate(0)) return 'Today'
  if (date === localDate(-1)) return 'Yesterday'
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const weekday = DAYS[new Date(y, m - 1, d).getDay()]
  const year = String(y) === localDate(0).slice(0, 4) ? '' : ` ${y}`
  return `${weekday}, ${d} ${MONTHS[m - 1]}${year}`
}

const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "2026-10-20" → "Tuesday, 20 October" */
export function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  return `${DAYS_LONG[new Date(y, m - 1, d).getDay()]}, ${d} ${MONTHS_LONG[m - 1]}`
}

/** "2026-10" → "October" (or "October 2025" for another year). */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const year = String(y) === localDate(0).slice(0, 4) ? '' : ` ${y}`
  return `${MONTHS_LONG[m - 1]}${year}`
}

/** The API stores icon names ("utensils") for default categories; only real emoji are shown. */
export function asEmoji(icon: string | null | undefined): string | null {
  return icon && !/^[a-z0-9-]+$/i.test(icon) ? icon : null
}

/** "1250000" → "1.250.000" — live formatting for amount fields. */
export const groupDigits = (digits: string) => (digits ? String(Number(digits)).replace(/\B(?=(\d{3})+(?!\d))/g, '.') : '')
