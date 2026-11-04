// Tracks continuous bed absence per side for auto-end.
// Presence flips a lot while someone lies still, so short presence blips do not reset an
// absence that is already running. Unknown presence (no fresh sensor frame, or no calibration)
// is not evidence of absence, so it can never end a session.
import type { Side } from './types'

// Presence must last this long before it cancels a running absence
export const PRESENCE_BLIP_SECONDS = 120

interface SidePresence {
  known: boolean
  present: boolean | null
  presentSince: number | null
  absentSince: number | null
}

const emptyPresence = (): SidePresence => ({ known: false, present: null, presentSince: null, absentSince: null })

// On globalThis because Turbopack can load more than one copy of a module
const globalState = globalThis as typeof globalThis & {
  __sp_sleepSessionPresence?: Record<Side, SidePresence>
}

const presence = (): Record<Side, SidePresence> => {
  globalState.__sp_sleepSessionPresence ??= { left: emptyPresence(), right: emptyPresence() }
  return globalState.__sp_sleepSessionPresence
}

const nowSeconds = () => Math.floor(Date.now() / 1000)

// `present` is null when the sensors can't say
export const recordPresence = (side: Side, present: boolean | null, at = nowSeconds()) => {
  const state = presence()[side]
  if (present === null) {
    state.known = false
    return
  }
  state.known = true
  if (present) {
    if (state.present !== true) state.presentSince = at
  }
  else if (state.present !== false) {
    const heldPresence = state.presentSince !== null && at - state.presentSince >= PRESENCE_BLIP_SECONDS
    // A real (non-blip) presence ends the old absence, so a new one starts now
    if (heldPresence || state.absentSince === null) state.absentSince = at
    state.presentSince = null
  }
  state.present = present
}

// Unix seconds when the current continuous absence began, or null if present or unknown
export const getAbsentSince = (side: Side, at = nowSeconds()): number | null => {
  const state = presence()[side]
  if (!state.known) return null
  if (state.present === true && state.presentSince !== null && at - state.presentSince >= PRESENCE_BLIP_SECONDS) {
    state.absentSince = null
  }
  return state.absentSince
}

// Only used by tests
export const resetPresence = () => {
  globalState.__sp_sleepSessionPresence = { left: emptyPresence(), right: emptyPresence() }
}
