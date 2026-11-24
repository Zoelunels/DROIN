export type TransactionType = 'income' | 'expense'
export type WalletType = 'cash' | 'bank' | 'ewallet' | 'savings' | 'other'
export type TransactionOrigin = 'manual' | 'transfer' | 'transfer_fee' | 'debt'
export type BudgetStatus = 'ok' | 'warning' | 'over'
export type DebtDirection = 'payable' | 'receivable'
export type DebtStatus = 'open' | 'overdue' | 'settled'
export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly'

export interface User {
  id: number
  email: string
  /** @username; null for accounts made before usernames, until they pick one. */
  username: string | null
  name: string
  timezone: string
  reminder_enabled: boolean
  reminder_time: string
  created_at: string
}

export interface AuthResponse {
  user: User
  token: string
}

/** POST /auth/verify: signed in, or (a new email) the code is right but the account needs a name and username. */
export type VerifyResponse = AuthResponse | { new_user: true }

/** GET /users?search= — someone on DROIN, for @-mentions. */
export interface UserMatch {
  username: string
  name: string
  is_friend: boolean
}

export interface Wallet {
  id: number
  name: string
  wallet_type: WalletType
  icon: string | null
  color: string | null
  balance: number
  archived_at: string | null
  created_at: string
  updated_at: string
}

export interface Category {
  id: number
  name: string
  type: TransactionType
  icon: string | null
  color: string | null
  system_key: 'opening_balance' | 'transfer_fee' | null
  archived_at: string | null
}

export interface Tag {
  id: number
  name: string
  color: string | null
}

export interface Transaction {
  id: number
  wallet_id: number
  wallet_name: string
  category_id: number | null
  category_name: string | null
  category_icon: string | null
  category_color: string | null
  type: TransactionType
  amount: number
  note: string | null
  transaction_date: string
  origin: TransactionOrigin
  transfer_id: number | null
  debt_id: number | null
  recurring_rule_id: number | null
  tags: Tag[]
  attachment_count: number
  created_at: string
  updated_at: string
}

export interface BudgetStatusItem {
  id: number
  category_id: number | null
  category_name: string | null
  amount: number
  spent: number
  remaining: number
  percentage: number
  status: BudgetStatus
  days_left: number
  daily_allowance: number
}

export interface BudgetStatusResponse {
  month: string
  budgets: BudgetStatusItem[]
}

export interface Goal {
  id: number
  name: string
  target_amount: number
  target_date: string | null
  saved_amount: number
  remaining: number
  progress: number
  completed: boolean
  overdue: boolean
  months_left: number | null
  monthly_needed: number | null
}

export interface Insight {
  type: string
  message: string
  [key: string]: unknown
}

export interface CategoryReport {
  from: string | null
  to: string | null
  income_total: number
  expense_total: number
  net: number
  categories: Array<{
    category_id: number
    category_name: string
    icon: string | null
    color: string | null
    type: TransactionType
    total: number
    count: number
    percentage: number
  }>
}

export interface DailyReport {
  month: string
  days: Array<{
    date: string
    income: number
    expense: number
    net: number
    count: number
  }>
}

/** GET /friends — people you split with often, and what they still owe you. */
export interface Friend {
  id: number
  name: string
  /** Set when the friend is a DROIN account: bills split with them show up in their app. */
  username: string | null
  owes_you: number
  created_at: string
}

/** A person on a split bill. `remaining` is what they still owe you. */
export interface SplitPerson {
  id: number
  position: number
  name: string
  is_me: boolean
  friend_id: number | null
  /** They have an account: they see this bill and can mark it paid themselves. */
  username: string | null
  share: number
  debt_id: number | null
  remaining: number
  status: 'me' | 'owes' | 'settled' | 'removed'
  /** When they marked it paid from their own app. */
  paid_marked_at: string | null
}

/** GET /splits/:id — a receipt you paid and shared. */
export interface Split {
  id: number
  title: string
  total: number
  split_date: string
  wallet_id: number
  wallet_name: string
  category_id: number
  category_name: string
  category_icon: string | null
  transaction_id: number | null
  items: { name: string; amount: number; people: number[] }[]
  people: SplitPerson[]
  my_share: number
  owed_to_me: number
  settled: boolean
}

/** GET /splits/shared — a bill someone else paid and split with you. `id` is your place on it. */
export interface SharedBill {
  id: number
  split_id: number
  position: number
  title: string
  total: number
  split_date: string
  items: { name: string; amount: number; people: number[] }[]
  owner: { name: string; username: string | null }
  share: number
  remaining: number
  status: 'owes' | 'settled' | 'removed'
  paid_marked_at: string | null
  paid_transaction_id: number | null
}

/** GET /splits/shared/:id — with everyone on the bill. */
export interface SharedBillDetail extends SharedBill {
  people: { position: number; name: string; share: number; is_payer: boolean; username: string | null }[]
}

export interface Debt {
  id: number
  direction: DebtDirection
  counterparty: string
  amount: number
  paid_amount: number
  remaining: number
  status: DebtStatus
  debt_date: string
  due_date: string | null
  wallet_id: number | null
  settled_at: string | null
}

export interface RecurringRule {
  id: number
  wallet_id: number
  category_id: number
  type: TransactionType
  amount: number
  note: string | null
  frequency: Frequency
  interval_count: number
  start_date: string
  end_date: string | null
  auto_create: boolean
  next_date: string | null
  occurrences_done: number
  paused: boolean
  wallet_name: string
  category_name: string
}

export interface Transfer {
  id: number
  from_wallet_id: number
  to_wallet_id: number
  amount: number
  fee: number
  transfer_date: string
  note: string | null
  from_wallet_name: string
  to_wallet_name: string
  from_transaction_id: number
  to_transaction_id: number
  fee_transaction_id: number | null
}

/** POST /quick-input/parse and /quick-input/voice: a transaction draft, nothing saved yet. */
export interface QuickDraft {
  amount: number | null
  type: TransactionType
  category_id: number | null
  category_name: string | null
  wallet_id: number | null
  wallet_name: string | null
  transaction_date: string
  note: string | null
  matched: {
    amount: boolean
    type: 'keyword' | 'category' | 'default'
    category: 'history' | 'name' | 'keyword' | 'none'
    wallet: 'name' | 'most_used' | 'none'
    date: 'text' | 'default'
  }
}

export interface VoiceResult {
  transcript: string
  drafts: QuickDraft[]
}

/** GET /reports/balances */
export interface BalanceReport {
  total: number
  wallets: Array<Pick<Wallet, 'id' | 'name' | 'wallet_type' | 'icon' | 'color' | 'balance'>>
}

/** GET /reports/monthly (one row per month) */
export interface MonthlyRow {
  month: string
  income: number
  expense: number
  net: number
}
