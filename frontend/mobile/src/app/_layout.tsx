import { Stack } from 'expo-router'
import { AppProviders } from '@/providers/AppProviders'

export default function RootLayout() {
  return (
    <AppProviders>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#FBFAF7' } }} />
    </AppProviders>
  )
}
