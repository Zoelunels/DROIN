import React, { useEffect, useState } from 'react'
import { ActivityIndicator, Image, Platform, Pressable, Text, View, type ImageStyle, type StyleProp } from 'react-native'
import { Icon } from '@/components/ui/Icon'
import { File, Paths } from 'expo-file-system'
import { Fonts, makeStyles, useColors } from '@/constants/colors'
import { getToken } from '@/lib/api'
import { attachmentUrl } from '@/lib/receipt'

type State = { status: 'loading' } | { status: 'ready'; uri: string } | { status: 'failed' }

/**
 * Where a stored receipt can be shown from. The server only hands photos out with the login token,
 * and an <Image> can't be trusted to send it (on the phone it often loads without it and gets a 401,
 * which is just a blank tile). So the photo is downloaded with the token: on the phone into the cache
 * once per attachment (reopening an entry is instant), in the browser into memory.
 */
async function loadReceipt(id: number, signal: { cancelled: boolean }): Promise<string> {
  const token = await getToken()
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}

  if (Platform.OS === 'web') {
    const res = await fetch(attachmentUrl(id), { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const blob = await res.blob()
    if (signal.cancelled) throw new Error('cancelled')
    return URL.createObjectURL(blob)
  }

  const cached = new File(Paths.cache, `receipt-${id}`)
  if (cached.exists && cached.size > 0) return cached.uri
  const file = await File.downloadFileAsync(attachmentUrl(id), cached, { headers, idempotent: true })
  return file.uri
}

/** Drops the phone's cached copy of a receipt photo (after it is deleted). */
export function forgetReceipt(id: number) {
  if (Platform.OS === 'web') return
  try {
    const cached = new File(Paths.cache, `receipt-${id}`)
    if (cached.exists) cached.delete()
  } catch {
    // Only a cache: the system clears it on its own when space runs low.
  }
}

/** A stored receipt photo, with a spinner while it loads and a retry tile if it can't. */
export function ReceiptImage({ id, style, contain }: { id: number; style?: StyleProp<ImageStyle>; contain?: boolean }) {
  const Colors = useColors()
  const styles = useStyles()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const signal = { cancelled: false }
    let objectUrl: string | null = null
    loadReceipt(id, signal)
      .then((uri) => {
        if (Platform.OS === 'web') objectUrl = uri
        if (!signal.cancelled) setState({ status: 'ready', uri })
      })
      .catch(() => {
        if (!signal.cancelled) setState({ status: 'failed' })
      })
    return () => {
      signal.cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [id, attempt])

  if (state.status === 'ready') {
    return (
      <Image
        source={{ uri: state.uri }}
        style={style}
        resizeMode={contain ? 'contain' : 'cover'}
        onError={() => setState({ status: 'failed' })}
        accessibilityLabel="Receipt photo"
      />
    )
  }

  if (state.status === 'failed') {
    return (
      <Pressable
        onPress={() => {
          setState({ status: 'loading' })
          setAttempt((n) => n + 1)
        }}
        accessibilityRole="button"
        accessibilityLabel="Receipt photo didn't load. Tap to try again"
        style={[styles.placeholder, style as object]}
      >
        <Icon name="image" size={22} color={Colors.muted} />
        <Text style={styles.retry}>Tap to retry</Text>
      </Pressable>
    )
  }

  return (
    <View style={[styles.placeholder, style as object]}>
      <ActivityIndicator color={Colors.orange} />
    </View>
  )
}

const useStyles = makeStyles((Colors) => ({
  placeholder: { alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: Colors.cream },
  retry: { fontSize: 12, fontFamily: Fonts.bold, color: Colors.muted, textAlign: 'center' },
}))
