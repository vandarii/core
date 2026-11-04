import { describe, expect, it, vi } from 'vitest'

vi.mock('@/src/db', () => ({ biometricsDb: {} }))

import { LOGGED_PUMP_MAX_AGE_MS } from '@/src/lib/pumpLog'
import { PumpLogRecorder } from '../pumpLogRecorder'

const NOW = 1_800_000_000_000
const line = (side: string, rpm: number, ts: number) => ({
  type: 'log', ts, msg: `frozen.cpp:286 handleCommand|[frozen] -> FW: pump[${side}] slow @ 50% (${rpm} rpm) [water]`,
})

describe('PumpLogRecorder', () => {
  it('writes each line at the firmware timestamp, carrying the other side', () => {
    const write = vi.fn()
    const recorder = new PumpLogRecorder(write)
    recorder.record(line('left', 0, 1000), NOW)
    expect(write).toHaveBeenLastCalledWith({ ts: 1000, left: 0, right: null })
    recorder.record(line('right', 2342, 1000), NOW)
    expect(write).toHaveBeenLastCalledWith({ ts: 1000, left: 0, right: 2342 })
    // A running pump logs about once a minute while the idle side stays quiet.
    recorder.record(line('right', 2340, 1060), NOW)
    expect(write).toHaveBeenLastCalledWith({ ts: 1060, left: 0, right: 2340 })
  })

  it('drops the other side once its reading is too old', () => {
    const write = vi.fn()
    const recorder = new PumpLogRecorder(write)
    recorder.record(line('left', 1200, 1000), NOW)
    recorder.record(line('right', 2342, 1000 + LOGGED_PUMP_MAX_AGE_MS / 1000 + 1), NOW)
    expect(write).toHaveBeenLastCalledWith({ ts: 1601, left: null, right: 2342 })
  })

  it('ignores other log lines and frames without a timestamp', () => {
    const write = vi.fn()
    const recorder = new PumpLogRecorder(write)
    recorder.record({ type: 'log', ts: 1000, msg: 'temps 33.68 23.56' }, NOW)
    recorder.record({ type: 'log', msg: line('left', 1, 0).msg }, NOW)
    expect(write).not.toHaveBeenCalled()
  })

  it('stands down while frzHealth telemetry is arriving', () => {
    const write = vi.fn()
    const recorder = new PumpLogRecorder(write)
    recorder.noteHealthFrame(NOW)
    recorder.record(line('left', 1, 1000), NOW + 1000)
    recorder.record(line('right', 2, 1000), NOW + 1000)
    expect(write).not.toHaveBeenCalled()
    recorder.record(line('left', 1, 2000), NOW + LOGGED_PUMP_MAX_AGE_MS)
    expect(write).toHaveBeenCalledOnce()
  })

  it('survives a failed write', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const recorder = new PumpLogRecorder(() => {
      throw new Error('disk full')
    })
    expect(() => recorder.record(line('right', 2, 1000), NOW)).not.toThrow()
    expect(error).toHaveBeenCalledOnce()
    error.mockRestore()
  })
})
