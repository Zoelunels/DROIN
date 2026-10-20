// DROIN toasts: a tiny store the ToastHost (components/ui/Toast.tsx) listens to. Keeps microcopy
// in one place so the app keeps its voice: "Into the drawer it goes." instead of "Saved".

export type NotifyTone = 'brand' | 'success' | 'error'

export interface ToastItem {
  id: number
  title: string
  description?: string
  tone: NotifyTone
  emoji: string
}

const MAX_VISIBLE = 3
let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<(items: ToastItem[]) => void>()

function emit() {
  for (const listener of listeners) listener(items)
}

export function subscribeToasts(listener: (items: ToastItem[]) => void) {
  listeners.add(listener)
  listener(items)
  return () => {
    listeners.delete(listener)
  }
}

export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id)
  emit()
}

function show(tone: NotifyTone, emoji: string, title: string, description?: string) {
  items = [...items, { id: nextId++, title, description, tone, emoji }].slice(-MAX_VISIBLE)
  emit()
}

export const notify = {
  info(title: string, description?: string, emoji?: string) {
    show('brand', emoji ?? '✨', title, description)
  },
  success(title: string, description?: string, emoji?: string) {
    show('success', emoji ?? '🎉', title, description)
  },
  error(title: string, description?: string, emoji?: string) {
    show('error', emoji ?? '😵', title, description)
  },
  saved(what = 'Entry') {
    show('success', '🗄️', `${what} tucked in!`, 'Into the drawer it goes.')
  },
}
