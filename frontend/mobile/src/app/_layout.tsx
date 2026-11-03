import { useEffect } from 'react'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import {
  Nunito_500Medium,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
  Nunito_900Black,
  useFonts,
} from '@expo-google-fonts/nunito'
import { useColors } from '@/constants/colors'
import { AppProviders } from '@/providers/AppProviders'

// Keep the splash (the mascot on cream) up until the fonts are in, so text never jumps fonts.
SplashScreen.preventAutoHideAsync().catch(() => {})

export default function RootLayout() {
  const [loaded, failed] = useFonts({ Nunito_500Medium, Nunito_600SemiBold, Nunito_700Bold, Nunito_800ExtraBold, Nunito_900Black })
  const ready = loaded || !!failed // without the fonts the app still works, in the system font

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {})
  }, [ready])

  if (!ready) return null
  return (
    <AppProviders>
      <ThemedStack />
    </AppProviders>
  )
}

/** Screens slide in over the theme's page colour (inside the theme provider, so it can read it). */
function ThemedStack() {
  const Colors = useColors()
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Colors.background }, animation: 'slide_from_right' }} />
}
