// Presence from the sleep-detector module, for Pods that send capSense frames.
// getOccupancy only scores capSense2, so on those Pods it is never available. The detector
// already scores capSense with debounce, hysteresis and drift tracking, and saves the result.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Side } from './types'

// The detector saves about once a minute. Older than this means it has stalled
export const DETECTOR_MAX_AGE_SECONDS = 180

const statePath = () => process.env.SLEEP_DETECTOR_STATE_PATH
  ?? path.join(path.dirname((process.env.BIOMETRICS_DATABASE_URL ?? 'file:/persistent/sleepypod-data/biometrics.db').replace(/^file:/, '')), 'sleep-detector-state.json')

/** True or false only when the detector is fresh and calibrated. Otherwise null, which never counts as absent */
export const parseDetectorPresence = (raw: string, side: Side, nowSeconds: number): boolean | null => {
  try {
    const state = (JSON.parse(raw) as Record<string, unknown>)[side] as {
      debounced_present?: unknown
      last_ts?: unknown
      baseline?: unknown
    } | undefined
    if (!state || typeof state.debounced_present !== 'boolean' || typeof state.last_ts !== 'number') return null
    // Without an empty-bed baseline, "not present" only means nothing has been measured
    if (typeof state.baseline !== 'object' || state.baseline === null) return null
    if (Math.abs(nowSeconds - state.last_ts) > DETECTOR_MAX_AGE_SECONDS) return null
    return state.debounced_present
  }
  catch {
    return null
  }
}

export const readDetectorPresence = (side: Side, nowSeconds: number): boolean | null => {
  try {
    return parseDetectorPresence(readFileSync(statePath(), 'utf8'), side, nowSeconds)
  }
  catch {
    return null
  }
}
