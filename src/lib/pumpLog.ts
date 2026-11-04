/**
 * Pump speed recovered from firmware log lines, for Pods whose firmware sends
 * no frzHealth frame. The firmware logs a running pump about once a minute
 * and an idle one about every 5 minutes:
 *
 *   frozen.cpp:286 handleCommand|[frozen] -> FW: pump[right] slow @ 50% (2342 rpm) [water]
 *
 * These are occasional samples, not telemetry. They can show a pump running,
 * but a gap between them proves nothing, so they must never reach the stall
 * guard or the stale-reading "stalled" verdict.
 */

/** Two idle logging cycles: past this a logged reading no longer describes the pump. */
export const LOGGED_PUMP_MAX_AGE_MS = 10 * 60_000

export const FLOW_SOURCE_LOG = 'log'

const PUMP_LINE = /\bpump\[(left|right)\] \w+ @ \d+% \((\d+) rpm\)/

export function parsePumpLogLine(msg: unknown): { side: 'left' | 'right', rpm: number } | null {
  if (typeof msg !== 'string') return null
  const match = PUMP_LINE.exec(msg)
  if (!match) return null
  return { side: match[1] as 'left' | 'right', rpm: Number(match[2]) }
}

/** The stored pump speeds, or null once the reading is too old to show as current. */
export function recentPumpReading(
  row: { timestamp: Date | string, leftPumpRpm: number | null, rightPumpRpm: number | null } | null | undefined,
  now: number,
): { left: number | null, right: number | null, ageMs: number } | null {
  if (!row) return null
  const ageMs = now - new Date(row.timestamp).getTime()
  if (ageMs > LOGGED_PUMP_MAX_AGE_MS) return null
  return { left: row.leftPumpRpm, right: row.rightPumpRpm, ageMs }
}
