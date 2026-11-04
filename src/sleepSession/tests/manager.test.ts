import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '@/src/db/schema'
import { isSessionError, SessionError, SleepSessionManager, type SessionHardware, type SessionManagerDeps } from '../manager'
import { resetPresence } from '../presenceTracker'
import { createSessionStore, type SessionStore } from '../store'
import { DEFAULT_SESSION_SETTINGS, type SessionSettings, type Side } from '../types'

const START = 1_762_200_000
const MINUTE = 60

const fakeHardware = (): SessionHardware => ({
  powerOn: vi.fn(async () => undefined),
  powerOff: vi.fn(async () => undefined),
  applyTarget: vi.fn(async () => undefined),
  prepare: vi.fn(async () => undefined),
})

describe('SleepSessionManager', () => {
  let store: SessionStore
  let now: number
  let presence: Record<Side, boolean | null>
  let away: Record<Side, boolean>
  let podRoom: ReturnType<SessionManagerDeps['readPodRoom']>

  const managerWith = (hardware: SessionHardware | null) => new SleepSessionManager({
    store,
    hardware,
    now: () => now,
    timezone: () => 'UTC',
    withSideLock: (_side, task) => task(),
    isAway: side => away[side],
    readPodRoom: () => podRoom,
    readPresence: side => presence[side],
    log: () => undefined,
  })

  const enable = (changes: Partial<SessionSettings> = {}, side: Side = 'right') =>
    store.saveSettings(side, { ...DEFAULT_SESSION_SETTINGS, enabled: true, ...changes })

  const fullSession = (startedAt: number, hours = 8) => {
    const session = store.createSession({ side: 'right', startedAt, startSource: 'manual', isNap: false, wakeAt: null, dryRun: true })
    store.closeSession(session.id, startedAt + hours * 3600, 'manual', false)
  }

  beforeEach(() => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite, { schema })
    migrate(db, { migrationsFolder: path.resolve('src/db/migrations') })
    store = createSessionStore(db)
    now = START
    presence = { left: null, right: null }
    away = { left: false, right: false }
    podRoom = null
    resetPresence()
  })

  describe('dry run', () => {
    it('keeps every session in dry run while live control is not connected', async () => {
      enable({ dryRun: false })
      const manager = managerWith(null)
      const session = await manager.startSession({ side: 'right', source: 'manual' })
      expect(session.dryRun).toBe(true)
      expect(manager.getSideStatus('right')).toMatchObject({ dryRun: true, liveControlAvailable: false })
    })

    it('logs decisions without touching the hardware', async () => {
      enable()
      const hardware = fakeHardware()
      const session = await managerWith(hardware).startSession({ side: 'right', source: 'manual' })
      expect(store.listDecisions(session.id)).toMatchObject([{ stage: 'entry', setF: 76, dryRun: true }])
      expect(hardware.powerOn).not.toHaveBeenCalled()
      expect(hardware.applyTarget).not.toHaveBeenCalled()
    })

    it('refuses Get bed ready, which would change the temperature', async () => {
      enable()
      await expect(managerWith(fakeHardware()).prepareBed('right')).rejects.toThrow('Dry run')
    })
  })

  describe('live control', () => {
    it('powers on, applies the curve, and powers off at the end', async () => {
      enable({ dryRun: false })
      const hardware = fakeHardware()
      const manager = managerWith(hardware)
      await manager.startSession({ side: 'right', source: 'manual' })
      expect(hardware.powerOn).toHaveBeenCalledWith('right')
      expect(hardware.applyTarget).toHaveBeenCalledWith('right', 76)
      await manager.endSession({ side: 'right', reason: 'manual' })
      expect(hardware.powerOff).toHaveBeenCalledWith('right')
    })

    it('warms the bed for Get bed ready', async () => {
      enable({ dryRun: false })
      const hardware = fakeHardware()
      await managerWith(hardware).prepareBed('right')
      expect(hardware.prepare).toHaveBeenCalledWith('right', 76, 3600)
    })
  })

  describe('starting', () => {
    it('refuses a disabled side', async () => {
      await expect(managerWith(null).startSession({ side: 'right', source: 'manual' })).rejects.toThrow('disabled')
    })

    it('refuses a side in away mode', async () => {
      enable()
      away.right = true
      await expect(managerWith(null).startSession({ side: 'right', source: 'manual' })).rejects.toThrow('away mode')
    })

    it('returns the running session instead of starting a second one', async () => {
      enable()
      const manager = managerWith(null)
      const first = await manager.startSession({ side: 'right', source: 'manual' })
      const second = await manager.startSession({ side: 'right', source: 'tap' })
      expect(second.id).toBe(first.id)
    })

    it('refuses a wake time in the past as a bad request', async () => {
      enable()
      const refusal = await managerWith(null).startSession({ side: 'right', source: 'manual', wakeAt: START - 1 }).catch(error => error)
      expect(refusal).toBeInstanceOf(SessionError)
      expect(refusal.code).toBe('BAD_REQUEST')
    })

    it('keeps the two sides separate', async () => {
      enable({}, 'left')
      enable({}, 'right')
      const manager = managerWith(null)
      await manager.startSession({ side: 'right', source: 'manual' })
      expect(manager.getSideStatus('left').session).toBeNull()
    })
  })

  describe('the curve over a session', () => {
    it('follows the curve as time passes and logs each change', async () => {
      enable()
      const manager = managerWith(null)
      const session = await manager.startSession({ side: 'right', source: 'manual' })
      for (let minute = 1; minute <= 120; minute++) {
        now = START + minute * MINUTE
        await manager.tick()
      }
      const decisions = store.listDecisions(session.id)
      // No body clock yet, so cooling stops at base minus the cautious 2°F
      expect(decisions.at(-1)).toMatchObject({ stage: 'cooling', setF: 70, reason: 'schedule' })
      expect(decisions.map(decision => decision.setF)).toEqual([76, 75, 74, 73, 72, 71, 70])
    })

    it('does not log anything when nothing changed', async () => {
      enable()
      const manager = managerWith(null)
      const session = await manager.startSession({ side: 'right', source: 'manual' })
      now = START + 5 * MINUTE
      await manager.tick()
      expect(store.listDecisions(session.id)).toHaveLength(1)
    })

    it('carries on from the log after a restart', async () => {
      enable()
      const session = await managerWith(null).startSession({ side: 'right', source: 'manual' })
      now = START + 5 * MINUTE
      await managerWith(null).tick()
      expect(store.listDecisions(session.id)).toHaveLength(1)
    })

    it('holds the nap temperature for a nap', async () => {
      enable({ napTemperatureF: 74 })
      const session = await managerWith(null).startSession({ side: 'right', source: 'manual', nap: true })
      expect(store.listDecisions(session.id)).toMatchObject([{ setF: 74, reason: 'nap' }])
    })

    it('stops changing the temperature if disabled mid-session, but still ends it', async () => {
      enable()
      const manager = managerWith(null)
      const session = await manager.startSession({ side: 'right', source: 'manual' })
      enable({ enabled: false })
      now = START + 60 * MINUTE
      await manager.tick()
      expect(store.listDecisions(session.id)).toHaveLength(1)
      now = START + 15 * 60 * MINUTE
      await manager.tick()
      expect(store.getSession(session.id)).toMatchObject({ endReason: 'max_length' })
    })
  })

  describe('body clock', () => {
    it('allows full cooling once the body clock shows REM is unlikely', async () => {
      // 22:00 to 08:00 puts mid-sleep at 03:00 and the temperature minimum at 04:12,
      // so a 22:00 start is clear of the REM window
      const dayStart = START - (START % 86_400)
      for (let night = 1; night <= 4; night++) fullSession(dayStart - night * 86_400 - 2 * 3600, 10)
      enable()
      now = dayStart + 22 * 3600
      const started = now
      const manager = managerWith(null)
      const session = await manager.startSession({ side: 'right', source: 'manual' })
      expect(manager.getBodyClock('right', started).temperatureMinimumHour).toBeCloseTo(4.2)
      for (let minute = 1; minute <= 120; minute++) {
        now = started + minute * MINUTE
        await manager.tick()
      }
      expect(store.listDecisions(session.id).at(-1)?.setF).toBe(69)
    })

    it('leaves naps out of the estimate', async () => {
      const session = store.createSession({ side: 'right', startedAt: START - 3600, startSource: 'manual', isNap: true, wakeAt: null, dryRun: true })
      store.closeSession(session.id, START - 1800, 'manual', true)
      expect(managerWith(null).getBodyClock('right', START).sessionCount).toBe(0)
    })
  })

  describe('ending', () => {
    it('classifies a short session as a nap and a long one as sleep', async () => {
      enable()
      const manager = managerWith(null)
      await manager.startSession({ side: 'right', source: 'manual' })
      now = START + 30 * MINUTE
      expect((await manager.endSession({ side: 'right', reason: 'manual' }))?.isNap).toBe(true)

      await manager.startSession({ side: 'right', source: 'manual' })
      now += 8 * 60 * MINUTE
      expect((await manager.endSession({ side: 'right', reason: 'manual' }))?.isNap).toBe(false)
    })

    it('returns null when nothing is running', async () => {
      expect(await managerWith(null).endSession({ side: 'right', reason: 'manual' })).toBeNull()
    })

    it('auto-ends after an hour out of bed, backdated to when the person got up', async () => {
      enable()
      const manager = managerWith(null)
      const session = await manager.startSession({ side: 'right', source: 'manual' })
      presence.right = true
      now = START + 120 * MINUTE
      await manager.tick()
      presence.right = false
      const gotUp = START + 180 * MINUTE
      now = gotUp
      await manager.tick()
      now = gotUp + 59 * MINUTE
      await manager.tick()
      expect(store.getSession(session.id)?.endedAt).toBeNull()
      now = gotUp + 60 * MINUTE
      await manager.tick()
      expect(store.getSession(session.id)).toMatchObject({ endedAt: gotUp, endReason: 'out_of_bed' })
    })

    it('never auto-ends when presence is unknown', async () => {
      enable()
      const manager = managerWith(null)
      const session = await manager.startSession({ side: 'right', source: 'manual' })
      presence.right = false
      now = START + 10 * MINUTE
      await manager.tick()
      presence.right = null
      now = START + 180 * MINUTE
      await manager.tick()
      expect(store.getSession(session.id)?.endedAt).toBeNull()
    })

    it('reports presence in the status, including when it is unknown', () => {
      const manager = managerWith(null)
      expect(manager.getSideStatus('right').present).toBeNull()
      presence.right = true
      expect(manager.getSideStatus('right').present).toBe(true)
    })

    it('ends at the maximum length', async () => {
      enable({ maxSessionHours: 2 })
      const manager = managerWith(null)
      const session = await manager.startSession({ side: 'right', source: 'manual' })
      now = START + 120 * MINUTE
      await manager.tick()
      expect(store.getSession(session.id)).toMatchObject({ endReason: 'max_length', endedAt: now })
    })
  })

  describe('toggling and resuming', () => {
    it('starts when idle and ends when running', async () => {
      enable()
      const manager = managerWith(null)
      const started = await manager.toggleSession('right', 'tap')
      expect(started).toMatchObject({ endedAt: null, startSource: 'tap' })
      now = START + 8 * 60 * MINUTE
      expect(await manager.toggleSession('right', 'tap')).toMatchObject({ id: started.id, endReason: 'tap' })
    })

    it('resumes within 15 minutes and goes back to the nap intent', async () => {
      enable()
      const manager = managerWith(null)
      const session = await manager.startSession({ side: 'right', source: 'manual' })
      now = START + 30 * MINUTE
      await manager.endSession({ side: 'right', reason: 'manual' })
      now += 15 * MINUTE
      expect(manager.getSideStatus('right').canResume).toBe(true)
      expect(await manager.resumeSession('right')).toMatchObject({ id: session.id, endedAt: null, isNap: false })
    })

    it('refuses to resume after 15 minutes', async () => {
      enable()
      const manager = managerWith(null)
      await manager.startSession({ side: 'right', source: 'manual' })
      await manager.endSession({ side: 'right', reason: 'manual' })
      now += 15 * MINUTE + 1
      expect(manager.getSideStatus('right').canResume).toBe(false)
      await expect(manager.resumeSession('right')).rejects.toThrow('No recently ended session')
    })
  })

  describe('room', () => {
    it('prefers a fresh external reading and falls back to the Pod', () => {
      enable()
      podRoom = { hubAmbC: 24, coverAmbC: 26, humidity: 50 }
      const manager = managerWith(null)
      manager.reportRoom(19.8)
      expect(manager.getSideStatus('right')).toMatchObject({ roomC: 19.8, roomSource: 'external', humidity: 50 })
      now += 16 * MINUTE
      expect(manager.getSideStatus('right')).toMatchObject({ roomC: 24, roomSource: 'pod' })
    })

    it('cools the bed when the room is warm and logs why', async () => {
      enable({ roomCompensation: { enabled: true, referenceC: 20, calibrationOffsetC: 0 } })
      const manager = managerWith(null)
      manager.reportRoom(23)
      const session = await manager.startSession({ side: 'right', source: 'manual' })
      expect(store.listDecisions(session.id)).toMatchObject([{ targetF: 76, setF: 73 }])
    })
  })

  describe('settings', () => {
    it('starts from the safe defaults', () => {
      expect(managerWith(null).getSettings('right')).toEqual(DEFAULT_SESSION_SETTINGS)
      expect(DEFAULT_SESSION_SETTINGS).toMatchObject({ enabled: false, dryRun: true })
    })

    it('saves each side on its own', () => {
      const manager = managerWith(null)
      manager.updateSettings('right', { ...DEFAULT_SESSION_SETTINGS, baseTemperatureF: 70 })
      expect(manager.getSettings('right').baseTemperatureF).toBe(70)
      expect(manager.getSettings('left').baseTemperatureF).toBe(72)
    })

    it('rejects values outside the limits', () => {
      expect(() => managerWith(null).updateSettings('right', { ...DEFAULT_SESSION_SETTINGS, baseTemperatureF: 40 })).toThrow()
    })
  })

  it('recognises a SessionError from another copy of the module', () => {
    // Turbopack can load this module twice, which makes instanceof unreliable
    const fromOtherCopy = Object.assign(new Error('refused'), { name: 'SessionError', code: 'CONFLICT' })
    expect(fromOtherCopy).not.toBeInstanceOf(SessionError)
    expect(isSessionError(fromOtherCopy)).toBe(true)
    expect(isSessionError(new SessionError('refused'))).toBe(true)
    expect(isSessionError(new Error('boom'))).toBe(false)
  })

  it('keeps ticking the other side if one fails', async () => {
    enable({}, 'left')
    enable({}, 'right')
    const manager = managerWith(null)
    const left = await manager.startSession({ side: 'left', source: 'manual' })
    const right = await manager.startSession({ side: 'right', source: 'manual' })
    const original = store.getSettings
    store.getSettings = (side) => {
      if (side === 'left') throw new Error('boom')
      return original(side)
    }
    now = START + 60 * MINUTE
    await manager.tick()
    expect(store.listDecisions(left.id)).toHaveLength(1)
    expect(store.listDecisions(right.id).length).toBeGreaterThan(1)
  })
})
