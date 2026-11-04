import { describe, expect, it } from 'vitest'
import { DETECTOR_MAX_AGE_SECONDS, parseDetectorPresence } from '../detectorPresence'

const NOW = 1_793_759_700
const baseline = { format: 'capSense', means: { out: 1194, cen: 1485, in: 1635 }, threshold: 300 }
const state = (side: Record<string, unknown>) => JSON.stringify({ version: 1, right: side })
const fresh = { debounced_present: true, last_ts: NOW - 30, baseline }

describe('parseDetectorPresence', () => {
  it('reads present and absent from a fresh, calibrated side', () => {
    expect(parseDetectorPresence(state(fresh), 'right', NOW)).toBe(true)
    expect(parseDetectorPresence(state({ ...fresh, debounced_present: false }), 'right', NOW)).toBe(false)
  })

  it('treats a stalled detector as unknown, never as absent', () => {
    const stale = { ...fresh, debounced_present: false, last_ts: NOW - DETECTOR_MAX_AGE_SECONDS - 1 }
    expect(parseDetectorPresence(state(stale), 'right', NOW)).toBeNull()
  })

  it('accepts a save right at the age limit', () => {
    const edge = { ...fresh, last_ts: NOW - DETECTOR_MAX_AGE_SECONDS }
    expect(parseDetectorPresence(state(edge), 'right', NOW)).toBe(true)
  })

  it('treats a side with no baseline as unknown, never as absent', () => {
    expect(parseDetectorPresence(state({ ...fresh, debounced_present: false, baseline: null }), 'right', NOW)).toBeNull()
  })

  it('treats a timestamp from the future as unknown', () => {
    expect(parseDetectorPresence(state({ ...fresh, last_ts: NOW + DETECTOR_MAX_AGE_SECONDS + 1 }), 'right', NOW)).toBeNull()
  })

  it.each([
    ['broken JSON', '{"right": '],
    ['a missing side', state(fresh).replace('right', 'left')],
    ['a missing field', state({ last_ts: NOW, baseline })],
    ['a wrong type', state({ ...fresh, debounced_present: 'false' })],
  ])('treats %s as unknown', (_name, raw) => {
    expect(parseDetectorPresence(raw, 'right', NOW)).toBeNull()
  })
})
