// Production wiring for sleep sessions. The ticker runs on its own interval, like the Free Sleep version.
import { desc, eq, gte, and, lte } from 'drizzle-orm'
import { biometricsDb, db } from '@/src/db'
import { bedTemp, freezerTemp } from '@/src/db/biometrics-schema'
import { deviceSettings, sideSettings } from '@/src/db/schema'
import { withSideLock } from '@/src/hardware/sideLock'
import { getOccupancy } from '@/src/lib/occupancy'
import { AMBIENT_MAX_AGE_SECONDS } from './curve'
import { SleepSessionManager } from './manager'
import { createSessionStore } from './store'
import type { Side } from './types'

const TICK_MS = 60_000
const CHART_BUCKET_SECONDS = 300

const centi = (value: number | null) => (value === null ? null : value / 100)

const readPodRoom = (now: number) => {
  const oldest = new Date((now - AMBIENT_MAX_AGE_SECONDS) * 1000)
  const bed = biometricsDb.select().from(bedTemp).where(gte(bedTemp.timestamp, oldest)).orderBy(desc(bedTemp.timestamp)).limit(1).get()
  const hub = biometricsDb.select().from(freezerTemp).where(gte(freezerTemp.timestamp, oldest)).orderBy(desc(freezerTemp.timestamp)).limit(1).get()
  if (!bed && !hub) return null
  return { hubAmbC: centi(hub?.ambientTemp ?? null), coverAmbC: centi(bed?.ambientTemp ?? null), humidity: centi(bed?.humidity ?? null) }
}

const readPresence = (side: Side) => {
  const occupancy = getOccupancy(side)
  return occupancy.available ? occupancy.classification === 'person' : null
}

const globalState = globalThis as typeof globalThis & {
  __sp_sleepSessionManager?: SleepSessionManager
  __sp_sleepSessionTicker?: NodeJS.Timeout
}

export function getSleepSessionManager(): SleepSessionManager {
  globalState.__sp_sleepSessionManager ??= new SleepSessionManager({
    store: createSessionStore(db),
    // Live control is connected once the trial on the Pod has passed. Until then every session is a dry run
    hardware: null,
    now: () => Math.floor(Date.now() / 1000),
    timezone: () => db.select({ timezone: deviceSettings.timezone }).from(deviceSettings).limit(1).get()?.timezone || 'America/Los_Angeles',
    withSideLock,
    isAway: side => Boolean(db.select({ awayMode: sideSettings.awayMode }).from(sideSettings).where(eq(sideSettings.side, side)).get()?.awayMode),
    readPodRoom,
    readPresence,
    log: message => console.log(`[sleep-session] ${message}`),
  })
  return globalState.__sp_sleepSessionManager
}

export function startSleepSessionTicker(): void {
  if (globalState.__sp_sleepSessionTicker) return
  const tick = () => void getSleepSessionManager().tick()
  globalState.__sp_sleepSessionTicker = setInterval(tick, TICK_MS)
  tick()
}

export function stopSleepSessionTicker(): void {
  if (globalState.__sp_sleepSessionTicker) clearInterval(globalState.__sp_sleepSessionTicker)
  globalState.__sp_sleepSessionTicker = undefined
}

/** Room readings for a session's chart, averaged into 5-minute buckets */
export function readRoomHistory(startTime: number, endTime: number) {
  const range = [new Date(startTime * 1000), new Date(endTime * 1000)] as const
  const bed = biometricsDb.select({ timestamp: bedTemp.timestamp, ambientTemp: bedTemp.ambientTemp, humidity: bedTemp.humidity })
    .from(bedTemp).where(and(gte(bedTemp.timestamp, range[0]), lte(bedTemp.timestamp, range[1]))).all()
  const hub = biometricsDb.select({ timestamp: freezerTemp.timestamp, ambientTemp: freezerTemp.ambientTemp })
    .from(freezerTemp).where(and(gte(freezerTemp.timestamp, range[0]), lte(freezerTemp.timestamp, range[1]))).all()

  const buckets = new Map<number, { cover: number[], hub: number[], humidity: number[] }>()
  const bucket = (timestamp: Date) => {
    const seconds = Math.floor(timestamp.getTime() / 1000)
    const key = seconds - (seconds % CHART_BUCKET_SECONDS)
    const existing = buckets.get(key)
    if (existing) return existing
    const created: { cover: number[], hub: number[], humidity: number[] } = { cover: [], hub: [], humidity: [] }
    buckets.set(key, created)
    return created
  }
  for (const row of bed) {
    if (row.ambientTemp !== null) bucket(row.timestamp).cover.push(row.ambientTemp / 100)
    if (row.humidity !== null) bucket(row.timestamp).humidity.push(row.humidity / 100)
  }
  for (const row of hub) {
    if (row.ambientTemp !== null) bucket(row.timestamp).hub.push(row.ambientTemp / 100)
  }
  const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null)
  return [...buckets.entries()].sort(([a], [b]) => a - b).map(([timestamp, values]) => ({
    timestamp,
    coverAmbC: average(values.cover),
    hubAmbC: average(values.hub),
    humidity: average(values.humidity),
  }))
}
