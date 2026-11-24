import React from 'react'
import { Redirect } from 'expo-router'
import { Tabs } from 'expo-router/js-tabs'
import { TabBar } from '@/components/TabBar'
import { LoadingState } from '@/components/ui/States'
import { useColors } from '@/constants/colors'
import { useAuth } from '@/lib/auth'

// Everything behind the bottom menu needs an account; logged-out users go to /login.
export default function TabsLayout() {
  const Colors = useColors()
  const { isLoading, isAuthenticated, user } = useAuth()
  if (isLoading) return <LoadingState label="Opening the drawer…" />
  if (!isAuthenticated) return <Redirect href="/login" />
  // Accounts from before usernames pick one first (null from the server; undefined is just an old
  // cached profile while offline, which shouldn't lock anyone out).
  if (user?.username === null) return <Redirect href={{ pathname: '/profile', params: { required: '1' } }} />

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      // Back (the header arrow, Android's back gesture) returns to the screen you came from, so an
      // entry opened from History goes back to History and one opened from Home goes back Home.
      backBehavior="history"
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: Colors.background } }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="history" options={{ title: 'History' }} />
      <Tabs.Screen name="add" options={{ title: 'Add' }} />
      <Tabs.Screen name="wallets" options={{ title: 'Wallets' }} />
      <Tabs.Screen name="me" options={{ title: 'Me' }} />
      {/* An entry's details live inside the tabs (not on top of them) so the bottom menu stays put.
          It gets no button because TabBar only draws the five tabs it knows. Not `href: null`:
          since SDK 58 that marks the screen hidden, and opening a hidden screen redirects to Home. */}
      <Tabs.Screen name="transaction/[id]" options={{ title: 'Entry' }} />
    </Tabs>
  )
}
