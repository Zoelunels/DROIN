import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { ApiError, api, setToken, clearToken, getToken, getCachedUser, setCachedUser, setUnauthorizedHandler } from './api'
import { Endpoints } from '@/constants/api'
import type { User, VerifyResponse } from '@/types/api'

interface AuthState {
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean
}

export type VerifyResult = 'signed-in' | 'new-user'

interface AuthContextValue extends AuthState {
  /** Emails a 6-digit sign-in code. No passwords: owning the inbox is the login. */
  requestCode: (email: string) => Promise<void>
  /**
   * Signs in with the code. A new email returns 'new-user' (the code stays valid): ask for a name
   * and username, then call again with them to make the account.
   */
  verifyCode: (email: string, code: string, profile?: { name: string; username: string }) => Promise<VerifyResult>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  /** After the profile is changed (PUT /auth/me). */
  setUser: (user: User) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)
const LOGGED_OUT: AuthState = { user: null, isLoading: false, isAuthenticated: false }

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
  })

  const signedIn = useCallback(async (token: string, user: User) => {
    await setToken(token)
    await setCachedUser(user)
    setState({ user, isLoading: false, isAuthenticated: true })
  }, [])

  const refreshUser = useCallback(async () => {
    const token = await getToken()
    if (!token) {
      setState(LOGGED_OUT)
      return
    }
    try {
      const user = await api.get<User>(Endpoints.me)
      await setCachedUser(user)
      setState({ user, isLoading: false, isAuthenticated: true })
    } catch (err) {
      // Only a 401 means the login is gone. Offline or a sleeping server keeps you signed in with
      // the last-known profile; the screens show their own "can't reach" message.
      if (err instanceof ApiError && err.status === 401) {
        await clearToken()
        setState(LOGGED_OUT)
      } else {
        setState({ user: await getCachedUser<User>(), isLoading: false, isAuthenticated: true })
      }
    }
  }, [])

  useEffect(() => {
    refreshUser()
  }, [refreshUser])

  // Any later 401 (token expired or revoked elsewhere): forget it; the tab layout then redirects to /login.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearToken().catch(() => {})
      setState(LOGGED_OUT)
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  const requestCode = useCallback(async (email: string) => {
    await api.post(Endpoints.authCode, { email })
  }, [])

  const verifyCode = useCallback(
    async (email: string, code: string, profile?: { name: string; username: string }): Promise<VerifyResult> => {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const data = await api.post<VerifyResponse>(Endpoints.authVerify, { email, code, ...(profile ? { ...profile, timezone } : {}) })
      if ('new_user' in data) return 'new-user'
      await signedIn(data.token, data.user)
      return 'signed-in'
    },
    [signedIn],
  )

  const setUser = useCallback(async (user: User) => {
    await setCachedUser(user)
    setState({ user, isLoading: false, isAuthenticated: true })
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.post(Endpoints.logout)
    } catch { /* ignore */ }
    await clearToken()
    setState(LOGGED_OUT)
  }, [])

  const value = { ...state, requestCode, verifyCode, logout, refreshUser, setUser }

  return React.createElement(AuthContext.Provider, { value }, children)
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
