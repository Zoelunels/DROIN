import Constants from 'expo-constants'

// In Expo Go the phone loads the bundle from your computer (hostUri = "192.168.x.x:8081"), so the
// backend is on the same machine at port 3000. Set expo.extra.apiUrl in app.json to override.
const devHost = Constants.expoConfig?.hostUri?.split(':')[0]
const DEV_API_URL = `http://${devHost ?? 'localhost'}:3000`

export const API_BASE_URL: string =
  Constants.expoConfig?.extra?.apiUrl ?? DEV_API_URL

export const Endpoints = {
  health: '/health',
  register: '/auth/register',
  login: '/auth/login',
  logout: '/auth/logout',
  me: '/auth/me',
  password: '/auth/password',
  wallets: '/wallets',
  categories: '/categories',
  transactions: '/transactions',
  transfers: '/transfers',
  budgets: '/budgets',
  budgetStatus: '/budgets/status',
  recurring: '/recurring',
  recurringDue: '/recurring/due',
  goals: '/goals',
  debts: '/debts',
  debtsSummary: '/debts/summary',
  tags: '/tags',
  insights: '/insights',
  quickInput: '/quick-input/parse',
  quickInputVoice: '/quick-input/voice',
  quickInputReceipt: '/quick-input/receipt',
  exportXlsx: '/export/transactions.xlsx',
  exportCsv: '/export/transactions.csv',
  exportHtml: '/export/monthly-report.html',
  syncChanges: '/sync/changes',
  notificationTokens: '/notifications/tokens',
  notificationSettings: '/notifications/settings',
  reportCategories: '/reports/categories',
  reportTags: '/reports/tags',
  reportBalances: '/reports/balances',
  reportMonthly: '/reports/monthly',
  reportDaily: '/reports/daily',
} as const
