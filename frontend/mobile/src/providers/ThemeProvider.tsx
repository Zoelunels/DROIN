import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Platform, useColorScheme } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { ThemeContext, darkColors, lightColors, type ThemePreference } from '@/constants/colors'

const KEY = 'droin_theme'
const isWeb = Platform.OS === 'web'

async function loadPreference(): Promise<ThemePreference> {
  try {
    const saved = isWeb ? globalThis.localStorage?.getItem(KEY) : await SecureStore.getItemAsync(KEY)
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  } catch {
    return 'system'
  }
}

async function savePreference(preference: ThemePreference) {
  try {
    if (isWeb) globalThis.localStorage?.setItem(KEY, preference)
    else await SecureStore.setItemAsync(KEY, preference)
  } catch {
    // Only a convenience: the app falls back to the phone's setting.
  }
}

/**
 * Light or dark: the phone's setting ("System", the default), or the user's own pick from the Me
 * page, remembered on this device.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme()
  const [preference, setPreferenceState] = useState<ThemePreference>('system')

  useEffect(() => {
    loadPreference().then(setPreferenceState)
  }, [])

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    savePreference(next)
  }, [])

  const scheme = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference
  const value = useMemo(
    () => ({ colors: scheme === 'dark' ? darkColors : lightColors, scheme, preference, setPreference }),
    [scheme, preference, setPreference],
  )
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
