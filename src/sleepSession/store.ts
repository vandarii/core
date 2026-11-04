// Database access for sleep sessions. Takes the database as an argument so tests can use an in-memory one.
import { and, asc, desc, eq, gte, isNotNull, isNull, lte } from 'drizzle-orm'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import type * as schema from '@/src/db/schema'
import { sleepSessionDecisions, sleepSessionRoomReadings, sleepSessions, sleepSessionSettings } from '@/src/db/schema'
import { DEFAULT_SESSION_SETTINGS, sessionSettingsSchema, type SessionSettings, type Side } from './types'

type Database = BetterSQLite3Database<typeof schema>

export type SleepSession = typeof sleepSessions.$inferSelect
export type SessionDecision = typeof sleepSessionDecisions.$inferSelect
export type NewSession = Pick<typeof sleepSessions.$inferInsert, 'side' | 'startedAt' | 'startSource' | 'wakeAt' | 'dryRun'> & { isNap: boolean }
export type NewDecision = typeof sleepSessionDecisions.$inferInsert

// External room readings are stored in 5-minute buckets
const ROOM_BUCKET_SECONDS = 300

export const createSessionStore = (db: Database) => ({
  getSettings(side: Side): SessionSettings {
    const row = db.select().from(sleepSessionSettings).where(eq(sleepSessionSettings.side, side)).get()
    if (!row) return DEFAULT_SESSION_SETTINGS
    // A stored value that no longer validates falls back to the safe defaults
    const parsed = sessionSettingsSchema.safeParse(JSON.parse(row.settings))
    return parsed.success ? parsed.data : DEFAULT_SESSION_SETTINGS
  },

  saveSettings(side: Side, settings: SessionSettings) {
    const value = JSON.stringify(settings)
    db.insert(sleepSessionSettings).values({ side, settings: value })
      .onConflictDoUpdate({ target: sleepSessionSettings.side, set: { settings: value } }).run()
  },

  getActiveSession(side: Side): SleepSession | null {
    return db.select().from(sleepSessions)
      .where(and(eq(sleepSessions.side, side), isNull(sleepSessions.endedAt)))
      .orderBy(desc(sleepSessions.startedAt)).limit(1).get() ?? null
  },

  getLastEndedSession(side: Side): SleepSession | null {
    return db.select().from(sleepSessions)
      .where(and(eq(sleepSessions.side, side), isNotNull(sleepSessions.endedAt)))
      .orderBy(desc(sleepSessions.endedAt)).limit(1).get() ?? null
  },

  createSession(input: NewSession): SleepSession {
    return db.insert(sleepSessions).values({ ...input, napRequested: input.isNap }).returning().get()
  },

  closeSession(id: number, endedAt: number, endReason: NonNullable<SleepSession['endReason']>, isNap: boolean): SleepSession {
    return db.update(sleepSessions).set({ endedAt, endReason, isNap }).where(eq(sleepSessions.id, id)).returning().get()
  },

  // A resumed session goes back to its original nap intent. The duration-based nap
  // classification is worked out again when it ends
  reopenSession(session: SleepSession): SleepSession {
    return db.update(sleepSessions).set({ endedAt: null, endReason: null, isNap: session.napRequested })
      .where(eq(sleepSessions.id, session.id)).returning().get()
  },

  getSession(id: number): SleepSession | null {
    return db.select().from(sleepSessions).where(eq(sleepSessions.id, id)).get() ?? null
  },

  listSessions(side: Side | undefined, limit: number): SleepSession[] {
    return db.select().from(sleepSessions)
      .where(side ? eq(sleepSessions.side, side) : undefined)
      .orderBy(desc(sleepSessions.startedAt)).limit(limit).all()
  },

  // Full sleep sessions that ended within a time range, for the body clock estimate
  listFullSessionsBetween(side: Side, startTime: number, endTime: number): SleepSession[] {
    return db.select().from(sleepSessions)
      .where(and(
        eq(sleepSessions.side, side), eq(sleepSessions.isNap, false),
        isNotNull(sleepSessions.endedAt), gte(sleepSessions.endedAt, startTime), lte(sleepSessions.endedAt, endTime),
      ))
      .orderBy(desc(sleepSessions.startedAt)).all()
  },

  insertDecision(input: NewDecision): SessionDecision {
    return db.insert(sleepSessionDecisions).values(input).returning().get()
  },

  getLastDecision(sessionId: number): SessionDecision | null {
    return db.select().from(sleepSessionDecisions).where(eq(sleepSessionDecisions.sessionId, sessionId))
      .orderBy(desc(sleepSessionDecisions.timestamp), desc(sleepSessionDecisions.id)).limit(1).get() ?? null
  },

  listDecisions(sessionId: number): SessionDecision[] {
    return db.select().from(sleepSessionDecisions).where(eq(sleepSessionDecisions.sessionId, sessionId))
      .orderBy(asc(sleepSessionDecisions.timestamp), asc(sleepSessionDecisions.id)).all()
  },

  saveRoomReading(temperatureC: number, now: number) {
    const timestamp = now - (now % ROOM_BUCKET_SECONDS)
    db.insert(sleepSessionRoomReadings).values({ timestamp, temperatureC })
      .onConflictDoUpdate({ target: sleepSessionRoomReadings.timestamp, set: { temperatureC } }).run()
  },

  getLatestRoomC(maxAgeSeconds: number, now: number): number | null {
    return db.select().from(sleepSessionRoomReadings)
      .where(gte(sleepSessionRoomReadings.timestamp, now - maxAgeSeconds))
      .orderBy(desc(sleepSessionRoomReadings.timestamp)).limit(1).get()?.temperatureC ?? null
  },

  listRoomReadings(startTime: number, endTime: number) {
    return db.select().from(sleepSessionRoomReadings)
      .where(and(gte(sleepSessionRoomReadings.timestamp, startTime), lte(sleepSessionRoomReadings.timestamp, endTime)))
      .orderBy(asc(sleepSessionRoomReadings.timestamp)).all()
  },
})

export type SessionStore = ReturnType<typeof createSessionStore>
