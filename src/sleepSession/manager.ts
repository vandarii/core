// Starts, ends and resumes sleep sessions, and steps the temperature curve while one runs.
// Everything it touches comes in through SessionManagerDeps, so it can be tested without a Pod.
import { coolDepthForSession, estimateTemperatureMinimumHour, MIN_SESSIONS_FOR_ESTIMATE } from './bodyClock'
import {
  AMBIENT_MAX_AGE_SECONDS,
  describeDecision,
  planTemperature,
  resolveRoom,
  shouldApply,
  type TemperaturePlan,
} from './curve'
import { getAbsentSince, recordPresence } from './presenceTracker'
import type { SessionDecision, SessionStore, SleepSession } from './store'
import { sessionSettingsSchema, type PodRoomReading, type SessionEndReason, type SessionSettings, type SessionSource, type Side } from './types'

// An ended session can be resumed for this long, in case an auto-end was a mistake
export const RESUME_WINDOW_SECONDS = 15 * 60
const BODY_CLOCK_WINDOW_SECONDS = 14 * 24 * 60 * 60
// "Get bed ready" turns itself off if no session starts
const PREPARE_BED_SECONDS = 60 * 60
const SIDES: Side[] = ['left', 'right']

export class SessionError extends Error {
  override readonly name = 'SessionError'

  constructor(message: string, readonly code: 'CONFLICT' | 'BAD_REQUEST' = 'CONFLICT') {
    super(message)
  }
}

// Checks the name, not instanceof: Turbopack can load two copies of this module, and the
// manager singleton then throws a different SessionError class from the one a router imports
export const isSessionError = (error: unknown): error is SessionError =>
  error instanceof Error && error.name === 'SessionError'

/** How sessions reach the bed. Null until live control is connected, which keeps every session in dry run. */
export interface SessionHardware {
  powerOn: (side: Side) => Promise<void>
  powerOff: (side: Side) => Promise<void>
  applyTarget: (side: Side, temperatureF: number) => Promise<void>
  prepare: (side: Side, temperatureF: number, seconds: number) => Promise<void>
}

export interface SessionManagerDeps {
  store: SessionStore
  hardware: SessionHardware | null
  /** Unix seconds */
  now: () => number
  timezone: () => string
  withSideLock: <T>(side: Side, task: () => Promise<T>) => Promise<T>
  isAway: (side: Side) => boolean
  readPodRoom: (now: number) => (PodRoomReading & { humidity: number | null }) | null
  /** Null when the sensors can't say */
  readPresence: (side: Side) => boolean | null
  log: (message: string) => void
}

export interface BodyClock {
  temperatureMinimumHour: number | null
  sessionCount: number
  sessionsNeeded: number
}

export interface SessionSideStatus {
  enabled: boolean
  dryRun: boolean
  liveControlAvailable: boolean
  session: SleepSession | null
  stage: SessionDecision['stage'] | null
  stageTargetF: number | null
  setF: number | null
  bodyClock: BodyClock
  roomC: number | null
  roomSource: 'external' | 'pod' | null
  humidity: number | null
  absentSince: number | null
  lastDecision: SessionDecision | null
  lastSession: SleepSession | null
  canResume: boolean
}

interface StartOptions {
  side: Side
  source: SessionSource
  wakeAt?: number
  nap?: boolean
}

interface EndOptions {
  side: Side
  reason: SessionEndReason
  /** Backdated end time, such as when the person actually left the bed */
  endedAt?: number
}

const hourOfDay = (unixSeconds: number, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(new Date(unixSeconds * 1000))
  const value = (type: string) => Number(parts.find(part => part.type === type)?.value ?? 0)
  return value('hour') + value('minute') / 60
}

export class SleepSessionManager {
  constructor(private readonly deps: SessionManagerDeps) {}

  private get store() {
    return this.deps.store
  }

  private isDryRun(settings: SessionSettings) {
    return settings.dryRun || this.deps.hardware === null
  }

  /** The two weeks of full sleep sessions before a moment in time */
  getBodyClock(side: Side, before: number): BodyClock {
    const sessions = this.store.listFullSessionsBetween(side, before - BODY_CLOCK_WINDOW_SECONDS, before)
    const midSleepHours = sessions.map(session =>
      hourOfDay((session.startedAt + (session.endedAt ?? session.startedAt)) / 2, this.deps.timezone()))
    return {
      temperatureMinimumHour: estimateTemperatureMinimumHour(midSleepHours),
      sessionCount: sessions.length,
      sessionsNeeded: MIN_SESSIONS_FOR_ESTIMATE,
    }
  }

  private readRoom(settings: SessionSettings, now: number) {
    const pod = this.deps.readPodRoom(now)
    const externalRoomC = this.store.getLatestRoomC(AMBIENT_MAX_AGE_SECONDS, now)
    return { ...resolveRoom(pod, externalRoomC, settings), humidity: pod?.humidity ?? null }
  }

  /** One control step: plan the temperature, then apply it, or only log it in dry run. Call inside the side lock */
  private async step(side: Side, settings: SessionSettings, session: SleepSession, now: number): Promise<TemperaturePlan> {
    const last = this.store.getLastDecision(session.id)
    const plan = planTemperature({
      settings,
      startedAt: session.startedAt,
      now,
      coolDepthF: coolDepthForSession(
        settings.earlyCoolF,
        hourOfDay(session.startedAt, this.deps.timezone()),
        this.getBodyClock(side, session.startedAt).temperatureMinimumHour,
      ),
      wakeAt: session.wakeAt,
      isNap: session.isNap,
      roomC: this.readRoom(settings, now).roomC,
    })

    const apply = shouldApply({
      plan,
      lastTargetF: last?.targetF ?? null,
      lastSetF: last?.setF ?? null,
      lastChangeAt: last?.timestamp ?? null,
      now,
      minMinutesBetweenChanges: settings.minMinutesBetweenChanges,
    })

    if (apply) {
      if (!session.dryRun) await this.deps.hardware?.applyTarget(side, plan.desiredF)
      this.store.insertDecision({
        sessionId: session.id,
        timestamp: now,
        stage: plan.stage,
        targetF: plan.stageTargetF,
        setF: plan.desiredF,
        ...describeDecision(plan, last?.targetF ?? null),
        dryRun: session.dryRun,
      })
    }
    return plan
  }

  startSession({ side, source, wakeAt, nap }: StartOptions): Promise<SleepSession> {
    return this.deps.withSideLock(side, () => this.startLocked({ side, source, wakeAt, nap }))
  }

  private async startLocked({ side, source, wakeAt, nap }: StartOptions): Promise<SleepSession> {
    const settings = this.store.getSettings(side)
    if (!settings.enabled) throw new SessionError(`Autopilot is disabled for the ${side} side`)
    if (this.deps.isAway(side)) throw new SessionError(`The ${side} side is in away mode`)

    const existing = this.store.getActiveSession(side)
    if (existing) return existing

    const now = this.deps.now()
    if (wakeAt !== undefined && wakeAt <= now) throw new SessionError('Wake time must be in the future', 'BAD_REQUEST')

    const session = this.store.createSession({
      side,
      startedAt: now,
      startSource: source,
      isNap: nap ?? false,
      wakeAt: wakeAt ?? null,
      dryRun: this.isDryRun(settings),
    })
    this.deps.log(`started ${session.isNap ? 'nap' : 'sleep session'} #${session.id} on ${side} (${source})`)

    if (!session.dryRun) await this.deps.hardware?.powerOn(side)
    await this.step(side, settings, session, now)
    return session
  }

  /** Call inside the side lock */
  private async endLocked({ side, reason, endedAt }: EndOptions): Promise<SleepSession | null> {
    const session = this.store.getActiveSession(side)
    if (!session) return null

    const settings = this.store.getSettings(side)
    const endTime = Math.max(session.startedAt, endedAt ?? this.deps.now())
    const durationMinutes = (endTime - session.startedAt) / 60
    const isNap = session.napRequested || durationMinutes < settings.napMaxMinutes
    const closed = this.store.closeSession(session.id, endTime, reason, isNap)
    this.deps.log(`ended session #${session.id} on ${side} (${reason}), ${Math.round(durationMinutes)} min`)

    if (!session.dryRun) await this.deps.hardware?.powerOff(side)
    return closed
  }

  endSession(options: EndOptions): Promise<SleepSession | null> {
    return this.deps.withSideLock(options.side, () => this.endLocked(options))
  }

  /** Triple-tap behaviour: start when idle, end when a session is running */
  toggleSession(side: Side, source: SessionSource): Promise<SleepSession> {
    return this.deps.withSideLock(side, async () => {
      const ended = await this.endLocked({ side, reason: source === 'tap' ? 'tap' : 'manual' })
      return ended ?? this.startLocked({ side, source })
    })
  }

  /** Re-opens a session that ended within the resume window, such as a mistaken auto-end */
  resumeSession(side: Side): Promise<SleepSession> {
    return this.deps.withSideLock(side, async () => {
      if (this.store.getActiveSession(side)) throw new SessionError('A session is already running')
      const last = this.store.getLastEndedSession(side)
      if (!last?.endedAt || this.deps.now() - last.endedAt > RESUME_WINDOW_SECONDS) {
        throw new SessionError('No recently ended session to resume')
      }
      const session = this.store.reopenSession(last)
      this.deps.log(`resumed session #${session.id} on ${side}`)
      if (!session.dryRun) await this.deps.hardware?.powerOn(side)
      return session
    })
  }

  /** Warms the side to the entry temperature before bed. It needs no session and turns itself off after an hour */
  prepareBed(side: Side): Promise<void> {
    return this.deps.withSideLock(side, async () => {
      const settings = this.store.getSettings(side)
      if (!settings.enabled) throw new SessionError(`Autopilot is disabled for the ${side} side`)
      if (this.isDryRun(settings)) throw new SessionError('Dry run does not change the temperature')
      if (this.deps.isAway(side)) throw new SessionError(`The ${side} side is in away mode`)
      if (this.store.getActiveSession(side)) throw new SessionError('A session is already running')
      await this.deps.hardware?.prepare(side, settings.entryTemperatureF, PREPARE_BED_SECONDS)
      this.deps.log(`preparing ${side} side at ${settings.entryTemperatureF}°F`)
    })
  }

  private tickSide(side: Side, now: number): Promise<void> {
    return this.deps.withSideLock(side, async () => {
      recordPresence(side, this.deps.readPresence(side), now)
      const session = this.store.getActiveSession(side)
      if (!session) return
      const settings = this.store.getSettings(side)

      // Ending checks run even if Autopilot was disabled mid-session, so nothing is left running
      const absentSince = getAbsentSince(side, now)
      if (absentSince !== null) {
        const absenceStart = Math.max(absentSince, session.startedAt)
        if (now - absenceStart >= settings.autoEndAbsentMinutes * 60) {
          await this.endLocked({ side, reason: 'out_of_bed', endedAt: absenceStart })
          return
        }
      }
      if (now - session.startedAt >= settings.maxSessionHours * 3600) {
        await this.endLocked({ side, reason: 'max_length' })
        return
      }
      if (!settings.enabled || this.deps.isAway(side)) return
      await this.step(side, settings, session, now)
    })
  }

  async tick(): Promise<void> {
    const now = this.deps.now()
    for (const side of SIDES) {
      try {
        await this.tickSide(side, now)
      }
      catch (error) {
        // One side failing must not stop the other
        this.deps.log(`tick failed on ${side}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  getSideStatus(side: Side): SessionSideStatus {
    const now = this.deps.now()
    const settings = this.store.getSettings(side)
    const session = this.store.getActiveSession(side)
    const lastSession = this.store.getLastEndedSession(side)
    const room = this.readRoom(settings, now)
    const lastDecision = session ? this.store.getLastDecision(session.id) : null
    return {
      enabled: settings.enabled,
      dryRun: this.isDryRun(settings),
      liveControlAvailable: this.deps.hardware !== null,
      session,
      stage: lastDecision?.stage ?? null,
      stageTargetF: lastDecision?.targetF ?? null,
      setF: lastDecision?.setF ?? null,
      bodyClock: this.getBodyClock(side, session?.startedAt ?? now),
      roomC: room.roomC === null ? null : Math.round(room.roomC * 10) / 10,
      roomSource: room.source,
      humidity: room.humidity,
      absentSince: session ? getAbsentSince(side, now) : null,
      lastDecision,
      lastSession,
      canResume: !session && lastSession?.endedAt != null && now - lastSession.endedAt <= RESUME_WINDOW_SECONDS,
    }
  }

  getSettings(side: Side): SessionSettings {
    return this.store.getSettings(side)
  }

  updateSettings(side: Side, settings: SessionSettings): SessionSettings {
    const parsed = sessionSettingsSchema.parse(settings)
    this.store.saveSettings(side, parsed)
    return parsed
  }

  reportRoom(temperatureC: number) {
    this.store.saveRoomReading(temperatureC, this.deps.now())
  }
}
