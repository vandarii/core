import { sql } from 'drizzle-orm'
import { biometricsDb } from '@/src/db'
import { flowReadings } from '@/src/db/biometrics-schema'
import { FLOW_SOURCE_LOG, LOGGED_PUMP_MAX_AGE_MS, parsePumpLogLine } from '@/src/lib/pumpLog'

interface Reading { ts: number, rpm: number }
interface Row { ts: number, left: number | null, right: number | null }
type Write = (row: Row) => void

/**
 * Keyed on the firmware timestamp: a RAW replay after a restart lands on the
 * same rows, and two sides logged in one second merge into one row.
 */
function writeReading({ ts, left, right }: Row): void {
  biometricsDb
    .insert(flowReadings)
    .values({ timestamp: new Date(ts * 1000), leftPumpRpm: left, rightPumpRpm: right, source: FLOW_SOURCE_LOG })
    .onConflictDoUpdate({
      target: flowReadings.timestamp,
      set: {
        leftPumpRpm: sql`coalesce(excluded.left_pump_rpm, ${flowReadings.leftPumpRpm})`,
        rightPumpRpm: sql`coalesce(excluded.right_pump_rpm, ${flowReadings.rightPumpRpm})`,
      },
    })
    .run()
}

/**
 * Stores pump speed from firmware `log` frames on Pods without frzHealth.
 * Deliberately separate from DeviceStateSync.recordFlowData: that path feeds
 * the pump stall guard, which needs a steady frame stream these samples can't
 * provide. See src/lib/pumpLog.ts.
 *
 * The sides log independently (a running pump far more often than an idle
 * one), so each line writes a row, carrying the other side's last reading.
 */
export class PumpLogRecorder {
  private last: { left?: Reading, right?: Reading } = {}
  private lastHealthFrameAt = -Infinity

  constructor(private readonly write: Write = writeReading) {}

  /** Real telemetry wins: while frzHealth is arriving, log lines are ignored. */
  noteHealthFrame(now = Date.now()): void {
    this.lastHealthFrameAt = now
  }

  record(frame: Record<string, unknown>, now = Date.now()): void {
    const reading = parsePumpLogLine(frame.msg)
    const { ts } = frame
    if (!reading || typeof ts !== 'number' || !Number.isFinite(ts)) return
    if (now - this.lastHealthFrameAt < LOGGED_PUMP_MAX_AGE_MS) return

    this.last[reading.side] = { ts, rpm: reading.rpm }
    const current = (r: Reading | undefined) =>
      r && ts - r.ts <= LOGGED_PUMP_MAX_AGE_MS / 1000 ? r.rpm : null
    try {
      this.write({ ts, left: current(this.last.left), right: current(this.last.right) })
    }
    catch (error) {
      console.error('PumpLogRecorder: failed to write pump reading:', error instanceof Error ? error.message : error)
    }
  }
}
