import Constants from 'expo-constants'

// Which backend the app talks to, first match wins:
//   1. EXPO_PUBLIC_API_URL: set per build in eas.json / .env.production (the real server), or in
//      .env.development.local to point Expo Go at it. Baked in when the app is bundled.
//   2. expo.extra.apiUrl in app.json.
//   3. In Expo Go the phone loads the bundle from your computer (hostUri = "192.168.x.x:8081"), so
//      by default the backend is on that same machine at port 3000.
const devHost = Constants.expoConfig?.hostUri?.split(':')[0]
const DEV_API_URL = `http://${devHost ?? 'localhost'}:3000`

export const API_BASE_URL: string = (
  process.env.EXPO_PUBLIC_API_URL ||
  Constants.expoConfig?.extra?.apiUrl ||
  DEV_API_URL
).replace(/\/+$/, '')

export const Endpoints = {
  health: '/health',
  authCode: '/auth/code',
  authVerify: '/auth/verify',
  logout: '/auth/logout',
  me: '/auth/me',
  users: '/users',
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
  splits: '/splits',
  splitsShared: '/splits/shared',
  friends: '/friends',
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
