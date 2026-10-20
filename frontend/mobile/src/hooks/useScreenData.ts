import { useCallback, useState } from 'react'
import { useFocusEffect } from 'expo-router'

/**
 * Loads a screen's data every time the tab comes into view (so a transaction saved on the Add tab
 * shows up on Home right away), with pull-to-refresh. `load` must be stable (wrap it in useCallback).
 */
export function useScreenData<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [refreshing, setRefreshing] = useState(false)

  const run = useCallback(
    async (pulled = false) => {
      if (pulled) setRefreshing(true)
      try {
        setData(await load())
        setError(null)
      } catch (err) {
        setError(err)
      } finally {
        setRefreshing(false)
      }
    },
    [load],
  )

  useFocusEffect(
    useCallback(() => {
      run()
    }, [run]),
  )

  return { data, error, refreshing, refresh: () => run(true), reload: () => run() }
}
