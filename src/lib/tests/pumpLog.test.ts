import { describe, expect, it } from 'vitest'
import { LOGGED_PUMP_MAX_AGE_MS, parsePumpLogLine, recentPumpReading } from '../pumpLog'

describe('parsePumpLogLine', () => {
  it('reads the firmware pump status line', () => {
    expect(parsePumpLogLine('11959480 frozen.cpp:286 handleCommand|[frozen] -> FW: pump[right] slow @ 50% (2342 rpm) [water]'))
      .toEqual({ side: 'right', rpm: 2342 })
    expect(parsePumpLogLine('11029592 frozen.cpp:286 handleCommand|[frozen] -> FW: pump[left] off @ 0% (0 rpm) [water]'))
      .toEqual({ side: 'left', rpm: 0 })
  })

  it('ignores commands and unrelated lines', () => {
    expect(parsePumpLogLine('frozen.cpp:286 handleCommand|[frozen] -> FW: [pump-right] slow: 50%')).toBeNull()
    expect(parsePumpLogLine('tec[right] locked (pump)')).toBeNull()
    expect(parsePumpLogLine(undefined)).toBeNull()
  })
})

describe('recentPumpReading', () => {
  const now = 1_800_000_000_000
  const row = (ageMs: number) => ({ timestamp: new Date(now - ageMs), leftPumpRpm: 0, rightPumpRpm: 2342 })

  it('returns a reading within the age limit', () => {
    expect(recentPumpReading(row(60_000), now)).toEqual({ left: 0, right: 2342, ageMs: 60_000 })
  })

  it('drops a reading too old to describe the pump', () => {
    expect(recentPumpReading(row(LOGGED_PUMP_MAX_AGE_MS + 1), now)).toBeNull()
    expect(recentPumpReading(null, now)).toBeNull()
  })
})
