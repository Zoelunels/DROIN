import { useCallback, useRef, useState } from 'react'
import {
  RecordingPresets,
  getRecordingPermissionsAsync,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio'

// expo-audio is bundled in Expo Go, so this works without a development build. Speech needs far
// less than music: mono 16 kHz AAC keeps a 30 s clip around 200 KB for a quick upload.
const SPEECH: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 48_000,
  isMeteringEnabled: true,
}

export const MAX_RECORDING_MS = 30_000

/** granted · denied (can ask again) · blocked (only the Settings app can change it) */
export type MicPermission = 'unknown' | 'granted' | 'denied' | 'blocked'

export interface Recording {
  uri: string
  durationMs: number
}

export function useVoiceRecorder() {
  const recorder = useAudioRecorder(SPEECH)
  const state = useAudioRecorderState(recorder, 100)
  const [permission, setPermission] = useState<MicPermission>('unknown')
  const startedAt = useRef(0)

  /** Asks for the mic if needed, then starts recording when it is granted. */
  const start = useCallback(async (): Promise<MicPermission> => {
    let perm = await getRecordingPermissionsAsync()
    if (!perm.granted && perm.canAskAgain) perm = await requestRecordingPermissionsAsync()
    if (!perm.granted) {
      const result = perm.canAskAgain ? 'denied' : 'blocked'
      setPermission(result)
      return result
    }
    setPermission('granted')
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true })
    await recorder.prepareToRecordAsync()
    recorder.record()
    startedAt.current = Date.now()
    return 'granted'
  }, [recorder])

  const stop = useCallback(async (): Promise<Recording | null> => {
    await recorder.stop()
    // Give the speaker back to normal playback (iOS routes audio to the earpiece while recording).
    await setAudioModeAsync({ allowsRecording: false }).catch(() => {})
    const uri = recorder.uri
    return uri ? { uri, durationMs: Date.now() - startedAt.current } : null
  }, [recorder])

  // Metering is in dB (about -60 quiet room … 0 loud). Turned into 0…1 for the mic animation.
  const level = state.metering === undefined ? 0 : Math.max(0, Math.min(1, (state.metering + 60) / 60))

  return {
    start,
    stop,
    permission,
    isRecording: state.isRecording,
    durationMs: state.durationMillis,
    level,
  }
}
