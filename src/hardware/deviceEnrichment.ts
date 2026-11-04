import { desc } from 'drizzle-orm'
import { biometricsDb } from '@/src/db'
import { bedTemp, waterLevelReadings } from '@/src/db/biometrics-schema'
import { centiDegreesToC, centiDegreesToF, centiPercentToPercent } from '@/src/lib/tempUtils'

export type MattressTempsF = Record<'left' | 'right', number | null>

interface MattressRow {
  timestamp: Date
  leftOuterTemp: number | null
  leftCenterTemp: number | null
  leftInnerTemp: number | null
  rightOuterTemp: number | null
  rightCenterTemp: number | null
  rightInnerTemp: number | null
}

const MATTRESS_MAX_AGE_MS = 5 * 60_000
const NO_MATTRESS: MattressTempsF = { left: null, right: null }

/**
 * Mean surface temperature per side in °F, or null when missing or stale. This is the only
 * measured bed temperature: heatLevel follows the water at the Hub, which with the pump stopped
 * reached 42 °C while the mattress stayed near 24 °C.
 */
export function mattressTempsFromRow(row: MattressRow | undefined): MattressTempsF {
  if (!row || Date.now() - row.timestamp.getTime() > MATTRESS_MAX_AGE_MS) return NO_MATTRESS
  const meanF = (temps: (number | null)[]) => {
    const present = temps.filter(t => t != null)
    if (present.length === 0) return null
    const mean = present.reduce((sum, t) => sum + t, 0) / present.length
    return Math.round(centiDegreesToF(mean) * 10) / 10
  }
  return {
    left: meanF([row.leftOuterTemp, row.leftCenterTemp, row.leftInnerTemp]),
    right: meanF([row.rightOuterTemp, row.rightCenterTemp, row.rightInnerTemp]),
  }
}

interface DeviceEnrichment {
  mattressF: MattressTempsF
  roomClimate: { temperatureC: number | null, humidity: number | null, timestamp: number | null }
  waterLevelRaw: { raw: number | null, calibratedEmpty: number | null, calibratedFull: number | null, timestamp: number | null }
}

const CACHE_MS = 2_000
const globalState = globalThis as typeof globalThis & {
  __sp_device_enrichment__?: {
    value: DeviceEnrichment | null
    expiresAt: number
    pending: Promise<DeviceEnrichment> | null
  }
}

/** Sidecars write these tables outside Node; a short TTL bounds their visibility
 * delay. Keep hardware status, alarms and safety notices outside this cache. */
export function getDeviceEnrichment(): Promise<DeviceEnrichment> {
  const state = globalState.__sp_device_enrichment__ ??= { value: null, expiresAt: 0, pending: null }
  if (state.value && performance.now() < state.expiresAt) return Promise.resolve(state.value)
  if (state.pending) return state.pending
  state.pending = (async () => {
    const value: DeviceEnrichment = {
      mattressF: NO_MATTRESS,
      roomClimate: { temperatureC: null, humidity: null, timestamp: null },
      waterLevelRaw: { raw: null, calibratedEmpty: null, calibratedFull: null, timestamp: null },
    }
    try {
      const [latestBed] = await biometricsDb.select().from(bedTemp).orderBy(desc(bedTemp.timestamp)).limit(1)
      if (latestBed) {
        value.mattressF = mattressTempsFromRow(latestBed)
        value.roomClimate = {
          temperatureC: latestBed.ambientTemp === null ? null : centiDegreesToC(latestBed.ambientTemp),
          humidity: latestBed.humidity === null ? null : centiPercentToPercent(latestBed.humidity),
          timestamp: latestBed.timestamp?.getTime() ?? null,
        }
      }
    }
    catch { /* Return nulls instead of presenting stale readings as current. */ }
    try {
      const [latestWater] = await biometricsDb.select().from(waterLevelReadings).orderBy(desc(waterLevelReadings.timestamp)).limit(1)
      if (latestWater) {
        value.waterLevelRaw = {
          raw: latestWater.raw ?? null,
          calibratedEmpty: latestWater.calibratedEmpty ?? null,
          calibratedFull: latestWater.calibratedFull ?? null,
          timestamp: latestWater.timestamp?.getTime() ?? null,
        }
      }
    }
    catch { /* Retry after the short TTL, independently of the climate query. */ }
    state.value = value
    state.expiresAt = performance.now() + CACHE_MS
    return value
  })().finally(() => { state.pending = null })
  return state.pending
}

/** Latest known mattress temperatures for synchronous callers such as WebSocket frames. */
export function peekMattressTempsF(): MattressTempsF {
  return globalState.__sp_device_enrichment__?.value?.mattressF ?? NO_MATTRESS
}
