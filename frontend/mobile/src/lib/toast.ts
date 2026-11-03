// DROIN toasts: a tiny store the ToastHost (components/ui/Toast.tsx) listens to. Keeps microcopy
// in one place so the app keeps its voice: "Into the drawer it goes." instead of "Saved".

import type { IconName } from '@/components/ui/Icon'

export type NotifyTone = 'brand' | 'success' | 'error'

export interface ToastItem {
  id: number
  title: string
  description?: string
  tone: NotifyTone
  icon: IconName
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

function show(tone: NotifyTone, icon: IconName, title: string, description?: string) {
  items = [...items, { id: nextId++, title, description, tone, icon }].slice(-MAX_VISIBLE)
  emit()
}

export const notify = {
  info(title: string, description?: string, icon?: IconName) {
    show('brand', icon ?? 'info', title, description)
  },
  success(title: string, description?: string, icon?: IconName) {
    show('success', icon ?? 'check-circle', title, description)
  },
  error(title: string, description?: string, icon?: IconName) {
    show('error', icon ?? 'alert', title, description)
  },
  saved(what = 'Entry') {
    show('success', 'archive', `${what} tucked in!`, 'Into the drawer it goes.')
  },
}
