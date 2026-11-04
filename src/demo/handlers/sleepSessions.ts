import { TRPCError } from '@trpc/server'
import { planTemperature } from '@/src/sleepSession/curve'
import { DEFAULT_SESSION_SETTINGS, type SessionSettings, type Side } from '@/src/sleepSession/types'
import type { DemoHandlers, RouterOutputs } from '../types'

type Output = RouterOutputs['sleepSessions']
type Session = Output['list'][number]
type Decision = Output['getDetail']['decisions'][number]

const nowSeconds = () => Math.floor(Date.now() / 1000)
const DAY = 86_400
const ROOM_C = 21.4

let nextId = 1
const sessions: Session[] = []
const decisions = new Map<number, Decision[]>()
const settings: Record<Side, SessionSettings> = {
  left: { ...DEFAULT_SESSION_SETTINGS },
  right: { ...DEFAULT_SESSION_SETTINGS, enabled: true },
}

const curveDecisions = (session: Session, until: number, coolDepthF: number): Decision[] => {
  const rows: Decision[] = []
  let lastF: number | null = null
  for (let now = session.startedAt; now <= until; now += 60) {
    const plan = planTemperature({
      settings: settings[session.side], startedAt: session.startedAt, now, coolDepthF,
      wakeAt: session.wakeAt, isNap: session.isNap, roomC: null,
    })
    if (plan.desiredF === lastF) continue
    lastF = plan.desiredF
    rows.push({
      id: nextId++, sessionId: session.id, timestamp: now, stage: plan.stage, targetF: plan.stageTargetF,
      setF: plan.desiredF, reason: plan.reason, detail: plan.detail, dryRun: session.dryRun,
    })
  }
  return rows
}

const addSession = (side: Side, startedAt: number, endedAt: number | null, changes: Partial<Session> = {}) => {
  const session: Session = {
    id: nextId++, side, startedAt, endedAt, endReason: endedAt === null ? null : 'manual', startSource: 'manual',
    isNap: false, napRequested: false, wakeAt: null, dryRun: true, ...changes,
  }
  sessions.unshift(session)
  decisions.set(session.id, curveDecisions(session, endedAt ?? nowSeconds(), 2))
  return session
}

// A few past nights so the chart and history have something to show
for (let night = 4; night >= 1; night--) {
  const start = nowSeconds() - night * DAY - 9 * 3600
  addSession('right', start, start + 8 * 3600, { wakeAt: start + 8 * 3600, endReason: night === 2 ? 'out_of_bed' : 'manual' })
}

const activeSession = (side: Side) => sessions.find(session => session.side === side && session.endedAt === null) ?? null
const lastEnded = (side: Side) => sessions.find(session => session.side === side && session.endedAt !== null) ?? null

const status = (side: Side): Output['getStatus']['left'] => {
  const session = activeSession(side)
  if (session) decisions.set(session.id, curveDecisions(session, nowSeconds(), 2))
  const lastDecision = session ? decisions.get(session.id)?.at(-1) ?? null : null
  const lastSession = lastEnded(side)
  const fullSessions = sessions.filter(row => row.side === side && !row.isNap && row.endedAt !== null).length
  return {
    enabled: settings[side].enabled,
    dryRun: true,
    liveControlAvailable: false,
    session,
    stage: lastDecision?.stage ?? null,
    stageTargetF: lastDecision?.targetF ?? null,
    setF: lastDecision?.setF ?? null,
    bodyClock: { temperatureMinimumHour: fullSessions >= 4 ? 4.2 : null, sessionCount: fullSessions, sessionsNeeded: 4 },
    roomC: ROOM_C,
    roomSource: 'pod',
    humidity: 46,
    present: session ? true : false,
    absentSince: null,
    lastDecision,
    lastSession,
    canResume: !session && lastSession?.endedAt != null && nowSeconds() - lastSession.endedAt <= 15 * 60,
  }
}

const refuse = (message: string) => new TRPCError({ code: 'CONFLICT', message })

const end = (side: Side) => {
  const session = activeSession(side)
  if (!session) throw refuse('No session is running')
  session.endedAt = nowSeconds()
  session.endReason = 'manual'
  session.isNap = session.napRequested || (session.endedAt - session.startedAt) / 60 < settings[side].napMaxMinutes
  return session
}

const start = (side: Side, wakeAt?: number, nap?: boolean) => {
  if (!settings[side].enabled) throw refuse(`Autopilot is disabled for the ${side} side`)
  return activeSession(side) ?? addSession(side, nowSeconds(), null, { wakeAt: wakeAt ?? null, isNap: nap ?? false, napRequested: nap ?? false })
}

export const sleepSessions: DemoHandlers<'sleepSessions'> = {
  getStatus: () => ({ left: status('left'), right: status('right') }),
  start: ({ side, wakeAt, nap }) => start(side, wakeAt, nap),
  end: ({ side }) => end(side),
  toggle: ({ side }) => (activeSession(side) ? end(side) : start(side)),
  resume: ({ side }) => {
    const session = lastEnded(side)
    if (!session) throw refuse('No recently ended session to resume')
    session.endedAt = null
    session.endReason = null
    session.isNap = session.napRequested
    return session
  },
  prepare: () => {
    throw refuse('Dry run does not change the temperature')
  },
  list: ({ side, limit }) => sessions.filter(session => !side || session.side === side).slice(0, Number(limit)),
  getDetail: (input) => {
    const id = Number(input.id)
    const session = sessions.find(row => row.id === id)
    if (!session) throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found' })
    return { session, decisions: decisions.get(id) ?? [], room: [] }
  },
  getSettings: ({ side }) => settings[side],
  updateSettings: ({ side, settings: next }) => {
    settings[side] = next
    return next
  },
  reportRoom: () => ({ success: true }),
}

