import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'
import { API_BASE_URL } from '@/constants/api'

const TOKEN_KEY = 'droin_auth_token'
const USER_KEY = 'droin_user' // last-known profile, so the app still opens while offline

// SecureStore is native-only; the web build (browser preview) uses localStorage.
const isWeb = Platform.OS === 'web'
const store = {
  get: (key: string): Promise<string | null> =>
    isWeb ? Promise.resolve(globalThis.localStorage?.getItem(key) ?? null) : SecureStore.getItemAsync(key),
  set: async (key: string, value: string) => {
    if (isWeb) globalThis.localStorage?.setItem(key, value)
    else await SecureStore.setItemAsync(key, value)
  },
  remove: async (key: string) => {
    if (isWeb) globalThis.localStorage?.removeItem(key)
    else await SecureStore.deleteItemAsync(key)
  },
}

export const getToken = () => store.get(TOKEN_KEY)
export const setToken = (token: string) => store.set(TOKEN_KEY, token)

/** Forgets the login and the cached profile. */
export async function clearToken(): Promise<void> {
  await Promise.all([store.remove(TOKEN_KEY), store.remove(USER_KEY)])
}

export async function getCachedUser<T>(): Promise<T | null> {
  try {
    const raw = await store.get(USER_KEY)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
export const setCachedUser = (user: unknown) => store.set(USER_KEY, JSON.stringify(user)).catch(() => {})

// Called when the server rejects our token (expired or revoked), so the app can return to login.
let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler
}

type FetchOptions = {
  method?: string
  body?: unknown
  headers?: Record<string, string>
  params?: Record<string, string | number | boolean | undefined>
  /** Milliseconds before giving up (default 20 s). */
  timeout?: number
  /** Return the raw bytes instead of parsing JSON (file downloads). */
  raw?: boolean
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'ApiError'
  }

  /** No response at all: no signal, wrong Wi-Fi, or the backend is not running. */
  get offline() {
    return this.status === 0
  }
}

export async function apiFetch<T = unknown>(
  endpoint: string,
  options: FetchOptions = {}
): Promise<T> {
  const { method = 'GET', body, headers = {}, params, timeout = 20_000, raw = false } = options
  const token = await getToken()

  let url = `${API_BASE_URL}${endpoint}`
  if (params) {
    const searchParams = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) searchParams.append(key, String(value))
    })
    const qs = searchParams.toString()
    if (qs) url += `?${qs}`
  }

  const fetchHeaders: Record<string, string> = {
    ...headers,
  }

  if (token) {
    fetchHeaders['Authorization'] = `Bearer ${token}`
  }

  // FormData sets its own multipart Content-Type (with the boundary).
  const isForm = body instanceof FormData
  if (body && !isForm && !fetchHeaders['Content-Type']) {
    fetchHeaders['Content-Type'] = 'application/json'
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: fetchHeaders,
      body: isForm ? (body as FormData) : body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
  } catch {
    throw new ApiError(0, "Can't reach the drawer. Check your connection.")
  } finally {
    clearTimeout(timer)
  }

  // A 401 on a request that carried a token means the login is no longer valid. Login/register
  // send no token, so their "wrong password" 401s are left to the form.
  if (response.status === 401 && token) onUnauthorized?.()

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({ error: response.statusText }))
    throw new ApiError(response.status, errorBody.error || response.statusText)
  }

  if (response.status === 204) return undefined as T
  if (raw) return new Uint8Array(await response.arrayBuffer()) as T

  return response.json() as Promise<T>
}

export const api = {
  get: <T>(endpoint: string, params?: Record<string, string | number | boolean | undefined>) =>
    apiFetch<T>(endpoint, { params }),
  post: <T>(endpoint: string, body?: unknown, headers?: Record<string, string>) =>
    apiFetch<T>(endpoint, { method: 'POST', body, headers }),
  upload: <T>(endpoint: string, form: FormData, timeout = 45_000) =>
    apiFetch<T>(endpoint, { method: 'POST', body: form, timeout }),
  put: <T>(endpoint: string, body?: unknown) =>
    apiFetch<T>(endpoint, { method: 'PUT', body }),
  delete: <T>(endpoint: string) =>
    apiFetch<T>(endpoint, { method: 'DELETE' }),
  /** Downloads a file (with the login token) and returns its bytes. */
  download: (endpoint: string, params?: Record<string, string | number | boolean | undefined>) =>
    apiFetch<Uint8Array>(endpoint, { params, raw: true, timeout: 60_000 }),
}
