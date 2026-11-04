import { eq } from 'drizzle-orm'
import { db } from '@/src/db'
import { sideSettings } from '@/src/db/schema'
import type { Side } from '@/src/hardware/types'

/** °F the user chose for this side while it was off. A failed read must never block a power-on. */
export function readPowerOnTemperature(side: Side): number | null {
  try {
    return db.select({ temperature: sideSettings.powerOnTemperature }).from(sideSettings)
      .where(eq(sideSettings.side, side)).get()?.temperature ?? null
  }
  catch (error) {
    console.warn('[temperature] power-on temperature read failed:', error instanceof Error ? error.message : error)
    return null
  }
}

export function savePowerOnTemperature(side: Side, temperature: number): void {
  db.update(sideSettings).set({ powerOnTemperature: temperature }).where(eq(sideSettings.side, side)).run()
}
