// Shared types and settings for sleep sessions. These back the menu's Autopilot page.
// They are separate from src/automation, which is sleepypod's WHEN/IF/THEN rules engine.
import { z } from 'zod'

export type Side = 'left' | 'right'

// Parts of the time-based temperature curve. These are positions on a schedule, not detected sleep stages
export const SESSION_STAGES = ['entry', 'cooling', 'easing', 'steady', 'wake'] as const
export type SessionStage = typeof SESSION_STAGES[number]

const sessionTemperature = z.number().min(60).max(100)

export const sessionSettingsSchema = z.object({
  enabled: z.boolean(),
  // Log decisions without changing the temperature
  dryRun: z.boolean(),
  // Where the curve settles for the rest of the session
  baseTemperatureF: sessionTemperature,
  // Neutral temperature for getting into bed, cold entry is the least supported start
  entryTemperatureF: sessionTemperature,
  // How far below base the early part of the session goes
  earlyCoolF: z.number().min(0).max(10),
  // Rise over the last 30 minutes before an optional wake time
  wakeRiseF: z.number().min(0).max(6),
  napTemperatureF: sessionTemperature,
  // Room compensation never moves further than this from the curve when the room is warm
  maxAdjustmentF: z.number().min(0).max(10),
  minMinutesBetweenChanges: z.number().min(5).max(120),
  // Continuous absence that ends a session, backdated to when the absence began
  autoEndAbsentMinutes: z.number().min(10).max(240),
  maxSessionHours: z.number().min(2).max(24),
  // Sessions shorter than this are classified as naps when they end
  napMaxMinutes: z.number().min(0).max(240),
  roomCompensation: z.object({
    enabled: z.boolean(),
    referenceC: z.number().min(10).max(35),
    calibrationOffsetC: z.number().min(-10).max(10),
  }),
})

export type SessionSettings = z.infer<typeof sessionSettingsSchema>

// Same starting values as the Free Sleep Autopilot
export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  enabled: false,
  dryRun: true,
  baseTemperatureF: 72,
  entryTemperatureF: 76,
  earlyCoolF: 3,
  wakeRiseF: 4,
  napTemperatureF: 72,
  maxAdjustmentF: 4,
  minMinutesBetweenChanges: 20,
  autoEndAbsentMinutes: 60,
  maxSessionHours: 14,
  napMaxMinutes: 90,
  roomCompensation: { enabled: false, referenceC: 20, calibrationOffsetC: 0 },
}

export type SessionEndReason = 'manual' | 'tap' | 'api' | 'out_of_bed' | 'max_length'
export type SessionSource = 'manual' | 'tap' | 'api'
export type DecisionReason = 'schedule' | 'room' | 'wake' | 'nap'

// The Pod's own room sensors, in °C. The hub is the freezer unit and the cover is the bed sensor
export interface PodRoomReading {
  hubAmbC: number | null
  coverAmbC: number | null
}
