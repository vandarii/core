import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Characteristic } from 'hap-nodejs'

const enrichment = vi.hoisted(() => ({ temperatureC: null as number | null, read: vi.fn() }))

vi.mock('@/src/hardware/deviceEnrichment', () => ({
  getDeviceEnrichment: enrichment.read,
}))

import { buildAmbientSensor } from '../accessories/ambientSensor'

const current = (service: ReturnType<typeof buildAmbientSensor>['service']) =>
  service.getCharacteristic(Characteristic.CurrentTemperature).handleGetRequest()

describe('ambientSensor accessory', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    enrichment.temperatureC = null
    enrichment.read.mockReset().mockImplementation(async () => ({ roomClimate: { temperatureC: enrichment.temperatureC } }))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses the stable HomeKit display name and subtype', () => {
    const { service, stop } = buildAmbientSensor()
    expect(service.displayName).toBe('Pod ambient')
    expect(service.subtype).toBe('ambient')
    stop()
  })

  it('reports the room reading, whichever sensor it came from', async () => {
    enrichment.temperatureC = 21.5
    const { service, stop } = buildAmbientSensor()
    await vi.advanceTimersByTimeAsync(0)
    expect(await current(service)).toBeCloseTo(21.5, 2)
    stop()
  })

  it('returns the neutral 20°C sentinel before the first reading', async () => {
    const { service, stop } = buildAmbientSensor()
    expect(await current(service)).toBe(20)
    stop()
  })

  it('keeps the last known value when no reading is available', async () => {
    enrichment.temperatureC = 25
    const { service, stop } = buildAmbientSensor()
    await vi.advanceTimersByTimeAsync(0)

    enrichment.temperatureC = null
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await current(service)).toBeCloseTo(25, 2)
    stop()
  })

  it('polls on a 60s cadence', async () => {
    const { stop } = buildAmbientSensor()
    const before = enrichment.read.mock.calls.length
    await vi.advanceTimersByTimeAsync(180_000)
    expect(enrichment.read.mock.calls.length).toBeGreaterThanOrEqual(before + 3)
    stop()
  })

  it('stop() halts the poll interval', async () => {
    const { stop } = buildAmbientSensor()
    await vi.advanceTimersByTimeAsync(0)
    const after = enrichment.read.mock.calls.length
    stop()
    await vi.advanceTimersByTimeAsync(300_000)
    expect(enrichment.read.mock.calls.length).toBe(after)
  })
})
