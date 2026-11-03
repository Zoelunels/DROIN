import React from 'react'
import { View } from 'react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { ToastHost } from '@/components/ui/Toast'
import { useTheme } from '@/constants/colors'
import { AuthProvider } from '@/lib/auth'
import { ThemeProvider } from '@/providers/ThemeProvider'

/** The page colour and status bar follow the theme (dark icons on light, light icons on dark). */
function Themed({ children }: { children: React.ReactNode }) {
  const { colors, scheme } = useTheme()
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <View style={{ flex: 1, backgroundColor: colors.background }}>{children}</View>
      <ToastHost />
    </>
  )
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <Themed>{children}</Themed>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
