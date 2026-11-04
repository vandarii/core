import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { publicProcedure, router } from '@/src/server/trpc'
import { sideSchema } from '@/src/server/validation-schemas'
import { readRoomHistory, getSleepSessionManager } from '@/src/sleepSession/instance'
import { isSessionError, SessionError } from '@/src/sleepSession/manager'
import { createSessionStore } from '@/src/sleepSession/store'
import { SESSION_STAGES, sessionSettingsSchema } from '@/src/sleepSession/types'
import { db } from '@/src/db'

const sessionSchema = z.object({
  id: z.number(),
  side: z.enum(['left', 'right']),
  startedAt: z.number(),
  endedAt: z.number().nullable(),
  endReason: z.enum(['manual', 'tap', 'api', 'out_of_bed', 'max_length']).nullable(),
  startSource: z.enum(['manual', 'tap', 'api']),
  isNap: z.boolean(),
  napRequested: z.boolean(),
  wakeAt: z.number().nullable(),
  dryRun: z.boolean(),
})

const decisionSchema = z.object({
  id: z.number(),
  sessionId: z.number(),
  timestamp: z.number(),
  stage: z.enum(SESSION_STAGES),
  targetF: z.number(),
  setF: z.number(),
  reason: z.enum(['schedule', 'room', 'wake', 'nap']),
  detail: z.string().nullable(),
  dryRun: z.boolean(),
})

const statusSchema = z.object({
  enabled: z.boolean(),
  dryRun: z.boolean(),
  liveControlAvailable: z.boolean(),
  session: sessionSchema.nullable(),
  stage: z.enum(SESSION_STAGES).nullable(),
  stageTargetF: z.number().nullable(),
  setF: z.number().nullable(),
  bodyClock: z.object({
    temperatureMinimumHour: z.number().nullable(),
    sessionCount: z.number(),
    sessionsNeeded: z.number(),
  }),
  roomC: z.number().nullable(),
  roomSource: z.enum(['external', 'pod']).nullable(),
  humidity: z.number().nullable(),
  present: z.boolean().nullable(),
  absentSince: z.number().nullable(),
  lastDecision: decisionSchema.nullable(),
  lastSession: sessionSchema.nullable(),
  canResume: z.boolean(),
})

const roomPointSchema = z.object({
  timestamp: z.number(),
  coverAmbC: z.number().nullable(),
  hubAmbC: z.number().nullable(),
  humidity: z.number().nullable(),
  externalRoomC: z.number().nullable(),
})

const sideInput = z.object({ side: sideSchema }).strict()

// Turns expected refusals into clean API errors
const guarded = async <T>(task: () => Promise<T>): Promise<T> => {
  try {
    return await task()
  }
  catch (error) {
    if (isSessionError(error)) throw new TRPCError({ code: error.code, message: error.message })
    throw error
  }
}

export const sleepSessionsRouter = router({
  getStatus: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/sleep-sessions/status', protect: false, tags: ['SleepSessions'] } })
    .input(z.object({}).strict())
    .output(z.object({ left: statusSchema, right: statusSchema }))
    .query(() => {
      const manager = getSleepSessionManager()
      return { left: manager.getSideStatus('left'), right: manager.getSideStatus('right') }
    }),

  start: publicProcedure
    .meta({ openapi: { method: 'POST', path: '/sleep-sessions/start', protect: false, tags: ['SleepSessions'] } })
    .input(z.object({ side: sideSchema, wakeAt: z.number().int().positive().optional(), nap: z.boolean().optional() }).strict())
    .output(sessionSchema)
    .mutation(({ input }) => guarded(() => getSleepSessionManager().startSession({ ...input, source: 'manual' }))),

  end: publicProcedure
    .meta({ openapi: { method: 'POST', path: '/sleep-sessions/end', protect: false, tags: ['SleepSessions'] } })
    .input(sideInput)
    .output(sessionSchema)
    .mutation(({ input }) => guarded(async () => {
      const session = await getSleepSessionManager().endSession({ side: input.side, reason: 'manual' })
      if (!session) throw new SessionError('No session is running')
      return session
    })),

  toggle: publicProcedure
    .meta({ openapi: { method: 'POST', path: '/sleep-sessions/toggle', protect: false, tags: ['SleepSessions'] } })
    .input(sideInput)
    .output(sessionSchema)
    .mutation(({ input }) => guarded(() => getSleepSessionManager().toggleSession(input.side, 'api'))),

  resume: publicProcedure
    .meta({ openapi: { method: 'POST', path: '/sleep-sessions/resume', protect: false, tags: ['SleepSessions'] } })
    .input(sideInput)
    .output(sessionSchema)
    .mutation(({ input }) => guarded(() => getSleepSessionManager().resumeSession(input.side))),

  prepare: publicProcedure
    .meta({ openapi: { method: 'POST', path: '/sleep-sessions/prepare', protect: false, tags: ['SleepSessions'] } })
    .input(sideInput)
    .output(z.object({ success: z.boolean() }))
    .mutation(({ input }) => guarded(async () => {
      await getSleepSessionManager().prepareBed(input.side)
      return { success: true }
    })),

  list: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/sleep-sessions', protect: false, tags: ['SleepSessions'] } })
    .input(z.object({ side: sideSchema.optional(), limit: z.coerce.number().int().min(1).max(200).default(30) }).strict())
    .output(z.array(sessionSchema))
    .query(({ input }) => createSessionStore(db).listSessions(input.side, input.limit)),

  getDetail: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/sleep-sessions/detail', protect: false, tags: ['SleepSessions'] } })
    .input(z.object({ id: z.coerce.number().int().positive() }).strict())
    .output(z.object({ session: sessionSchema, decisions: z.array(decisionSchema), room: z.array(roomPointSchema) }))
    .query(({ input }) => {
      const store = createSessionStore(db)
      const session = store.getSession(input.id)
      if (!session) throw new TRPCError({ code: 'NOT_FOUND', message: 'Session not found' })
      const startTime = session.startedAt - 300
      const endTime = session.endedAt ?? Math.floor(Date.now() / 1000)
      const external = new Map(store.listRoomReadings(startTime, endTime).map(row => [row.timestamp, row.temperatureC]))
      const pod = readRoomHistory(startTime, endTime)
      const room = pod.map(point => ({ ...point, externalRoomC: external.get(point.timestamp) ?? null }))
      const podTimes = new Set(pod.map(point => point.timestamp))
      for (const [timestamp, externalRoomC] of external) {
        if (!podTimes.has(timestamp)) room.push({ timestamp, coverAmbC: null, hubAmbC: null, humidity: null, externalRoomC })
      }
      return { session, decisions: store.listDecisions(session.id), room: room.sort((a, b) => a.timestamp - b.timestamp) }
    }),

  getSettings: publicProcedure
    .meta({ openapi: { method: 'GET', path: '/sleep-sessions/settings', protect: false, tags: ['SleepSessions'] } })
    .input(sideInput)
    .output(sessionSettingsSchema)
    .query(({ input }) => getSleepSessionManager().getSettings(input.side)),

  updateSettings: publicProcedure
    .meta({ openapi: { method: 'POST', path: '/sleep-sessions/settings', protect: false, tags: ['SleepSessions'] } })
    .input(z.object({ side: sideSchema, settings: sessionSettingsSchema }).strict())
    .output(sessionSettingsSchema)
    .mutation(({ input }) => getSleepSessionManager().updateSettings(input.side, input.settings)),

  // Pushed by a trusted room sensor, such as a Home Assistant automation
  reportRoom: publicProcedure
    .meta({ openapi: { method: 'POST', path: '/sleep-sessions/room', protect: false, tags: ['SleepSessions'] } })
    .input(z.object({ temperatureC: z.number().min(-20).max(70) }).strict())
    .output(z.object({ success: z.boolean() }))
    .mutation(({ input }) => {
      getSleepSessionManager().reportRoom(input.temperatureC)
      return { success: true }
    }),
})
