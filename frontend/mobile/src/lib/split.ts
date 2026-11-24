import type { EditableItem } from '@/components/ReceiptBreakdown'

// A split bill being set up on the Add screen: who's in it and who had which item. Saved with
// POST /splits; the server works the shares out again the same way (backend/src/services/split.ts).

export interface BillPerson {
  key: string
  name: string
  me?: boolean
  /** A saved friend; null for a guest (just a name on this bill) or someone saved on the way. */
  friendId: number | null
  /** A DROIN account (picked by @username): the bill shows up in their app too. */
  username?: string | null
  /** Add to friends when saving (new names only). */
  save: boolean
}

export interface BillState {
  people: BillPerson[]
  /** item key → keys of the people who had it */
  assign: Record<string, string[]>
}

export const ME_KEY = 'me'

export const newPersonKey = () => `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

export function startBill(items: EditableItem[]): BillState {
  return {
    people: [{ key: ME_KEY, name: 'You', me: true, friendId: null, save: false }],
    assign: Object.fromEntries(items.map((i) => [i.key, [ME_KEY]])),
  }
}

/** The receipt lines a bill is split over: its items, or the whole bill as one line when it lists none. */
export function billItems(items: EditableItem[], total: number, title: string): EditableItem[] {
  const real = items.filter((i) => Number(i.amountText) > 0)
  if (real.length > 0) return real
  return total > 0 ? [{ key: 'whole', name: title || 'Whole bill', amountText: String(total) }] : []
}

/**
 * Each person's share of `total`, by person key. Items are split evenly between whoever had them;
 * tax, service and discounts (total ≠ items) are spread in proportion. Whole rupiah, and the shares
 * add up to exactly `total` (leftover rupiah go to the largest fractions, the payer first on a tie).
 */
export function computeShares(total: number, items: EditableItem[], bill: BillState): Record<string, number> {
  const keys = bill.people.map((p) => p.key)
  const base: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]))
  let itemsSum = 0
  for (const item of items) {
    const amount = Number(item.amountText) || 0
    const who = (bill.assign[item.key] ?? []).filter((k) => k in base)
    if (amount <= 0 || who.length === 0) continue
    itemsSum += amount
    for (const k of who) base[k]! += amount / who.length
  }
  const units = Math.round(total)
  const exact = keys.map((k) => (itemsSum > 0 ? (base[k]! / itemsSum) * units : 0))
  const shares = exact.map(Math.floor)
  let left = itemsSum > 0 ? units - shares.reduce((s, x) => s + x, 0) : 0
  const order = exact.map((e, i) => ({ i, frac: e - Math.floor(e) })).sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let n = 0; left > 0 && n < order.length; n++, left--) shares[order[n]!.i]!++
  return Object.fromEntries(keys.map((k, i) => [k, shares[i]!]))
}

/** What still stops this bill from being saved, in plain words. */
export function billProblem(items: EditableItem[], bill: BillState, total: number): string | null {
  if (bill.people.length < 2) return 'Add who you split it with.'
  if (items.length === 0) return 'How much was the bill?'
  const missing = items.find((i) => (bill.assign[i.key] ?? []).length === 0)
  if (missing) return `Who had ${missing.name || 'that item'}?`
  const shares = computeShares(total, items, bill)
  const idle = bill.people.find((p) => !p.me && !shares[p.key])
  if (idle) return `${idle.name} isn't on any item. Tap their circle on what they had.`
  return null
}

export const initialOf = (name: string) => (name.trim().charAt(0) || '?').toUpperCase()
