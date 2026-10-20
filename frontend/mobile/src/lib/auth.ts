import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { ApiError, api, setToken, clearToken, getToken, getCachedUser, setCachedUser, setUnauthorizedHandler } from './api'
import { Endpoints } from '@/constants/api'
import type { User, AuthResponse } from '@/types/api'

interface AuthState {
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, name: string) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
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

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await api.post<AuthResponse>(Endpoints.login, { email, password })
      await signedIn(data.token, data.user)
    },
    [signedIn],
  )

  const register = useCallback(
    async (email: string, password: string, name: string) => {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      const data = await api.post<AuthResponse>(Endpoints.register, { email, password, name, timezone })
      await signedIn(data.token, data.user)
    },
    [signedIn],
  )

  const logout = useCallback(async () => {
    try {
      await api.post(Endpoints.logout)
    } catch { /* ignore */ }
    await clearToken()
    setState(LOGGED_OUT)
  }, [])

  const value = { ...state, login, register, logout, refreshUser }

  return React.createElement(AuthContext.Provider, { value }, children)
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
