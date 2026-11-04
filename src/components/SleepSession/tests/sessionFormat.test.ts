import { describe, expect, it } from 'vitest'
import { resolveSessionView } from '../sessionViews'
import { collapseRamps, formatDuration, formatHour, formatOffset, formatRoom, formatTemp, nextWakeAt, type SessionDecision } from '../sessionFormat'

const decision = (id: number, changes: Partial<SessionDecision>): SessionDecision => ({
  id, sessionId: 1, timestamp: id * 60, stage: 'cooling', targetF: 72, setF: 72, reason: 'schedule', detail: null, dryRun: true, ...changes,
})

describe('sessionFormat', () => {
  it('formats temperatures in the chosen unit', () => {
    expect(formatTemp(72, 'F')).toBe('72°F')
    expect(formatTemp(68, 'C')).toBe('20.0°C')
    expect(formatTemp(null, 'F')).toBe('—')
  })

  it('formats offsets with a sign', () => {
    expect(formatOffset(-3, 'F')).toBe('−3°F')
    expect(formatOffset(4, 'F')).toBe('+4°F')
    expect(formatOffset(0, 'F')).toBe('±0°F')
    expect(formatOffset(9, 'C')).toBe('+5°C')
  })

  it('formats room temperatures from Celsius', () => {
    expect(formatRoom(20, 'F')).toBe('68°F')
    expect(formatRoom(20, 'C')).toBe('20.0°C')
    expect(formatRoom(null, 'C')).toBe('—')
  })

  it('formats durations and body clock hours', () => {
    expect(formatDuration(45 * 60)).toBe('45m')
    expect(formatDuration(8 * 3600 + 5 * 60)).toBe('8h 05m')
    expect(formatHour(4.2)).toBe('04:12')
    expect(formatHour(23.999)).toBe('00:00')
  })

  it('picks the next occurrence of a wake time', () => {
    const now = new Date(2026, 10, 3, 23, 0)
    expect(new Date(nextWakeAt('07:30', now) * 1000)).toEqual(new Date(2026, 10, 4, 7, 30))
    expect(new Date(nextWakeAt('23:30', now) * 1000)).toEqual(new Date(2026, 10, 3, 23, 30))
  })

  it('collapses a ramp into one row but keeps other reasons', () => {
    const rows = collapseRamps([
      decision(1, { stage: 'entry', setF: 76 }),
      decision(2, { setF: 75 }),
      decision(3, { setF: 74 }),
      decision(4, { setF: 72, reason: 'room', detail: 'Room warm at 23.0 °C' }),
      decision(5, { setF: 71 }),
    ])
    expect(rows.map(row => [row.decision.id, row.finalF])).toEqual([[1, undefined], [2, 74], [4, undefined], [5, undefined]])
  })

  it('opens Settings only when asked, and Sleep otherwise', () => {
    expect(resolveSessionView('settings')).toBe('settings')
    expect(resolveSessionView(null)).toBe('sleep')
    expect(resolveSessionView('anything')).toBe('sleep')
  })
})
