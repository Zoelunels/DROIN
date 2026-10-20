import React from 'react'
import { Redirect } from 'expo-router'
import { Tabs } from 'expo-router/js-tabs'
import { TabBar } from '@/components/TabBar'
import { LoadingState } from '@/components/ui/States'
import { Colors } from '@/constants/colors'
import { useAuth } from '@/lib/auth'

// Everything behind the bottom menu needs an account; logged-out users go to /login.
export default function TabsLayout() {
  const { isLoading, isAuthenticated } = useAuth()
  if (isLoading) return <LoadingState label="Opening the drawer…" />
  if (!isAuthenticated) return <Redirect href="/login" />

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: Colors.background } }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="history" options={{ title: 'History' }} />
      <Tabs.Screen name="add" options={{ title: 'Add' }} />
      <Tabs.Screen name="wallets" options={{ title: 'Wallets' }} />
      <Tabs.Screen name="me" options={{ title: 'Me' }} />
    </Tabs>
  )
}
