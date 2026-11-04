export type SessionView = 'sleep' | 'settings'

export const SESSION_VIEWS: ReadonlyArray<{ id: SessionView, label: string }> = [
  { id: 'sleep', label: 'Sleep' },
  { id: 'settings', label: 'Settings' },
]

/** Resolve `?view=`. Anything but Settings lands on Sleep */
export function resolveSessionView(raw: string | null): SessionView {
  return raw === 'settings' ? 'settings' : 'sleep'
}
