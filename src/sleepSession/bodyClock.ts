// Rough body clock estimate from recent sleep timing, used to hold back early cooling.
// REM follows the body clock as well as time asleep, so a morning sleeper can reach REM in the
// first cycle. Expect errors of 2-3 hours: this can restrain the controller, not locate REM.

export const MIN_SESSIONS_FOR_ESTIMATE = 4
// Typical gap from mid-sleep to the core temperature minimum, from regular sleepers
const MID_SLEEP_TO_TEMPERATURE_MINIMUM_HOURS = 1.2
// REM is most likely this many hours after the core temperature minimum
const REM_WINDOW_START_HOURS = 2
const REM_WINDOW_END_HOURS = 6
// Cooling depth allowed when REM may be likely or the body clock is unknown
export const CAUTIOUS_COOL_F = 2

const HOURS_PER_DAY = 24
const wrapHours = (hours: number) => ((hours % HOURS_PER_DAY) + HOURS_PER_DAY) % HOURS_PER_DAY

// Hours wrap at midnight, so 23:00 and 01:00 must average to 00:00 rather than 12:00
const circularMeanHours = (hours: number[]) => {
  const angles = hours.map(hour => (hour / HOURS_PER_DAY) * 2 * Math.PI)
  const sine = angles.reduce((sum, angle) => sum + Math.sin(angle), 0)
  const cosine = angles.reduce((sum, angle) => sum + Math.cos(angle), 0)
  return wrapHours((Math.atan2(sine, cosine) / (2 * Math.PI)) * HOURS_PER_DAY)
}

// midSleepHours are local clock hours of the middle of each recent session
export const estimateTemperatureMinimumHour = (midSleepHours: number[]) => {
  if (midSleepHours.length < MIN_SESSIONS_FOR_ESTIMATE) return null
  return wrapHours(circularMeanHours(midSleepHours) + MID_SLEEP_TO_TEMPERATURE_MINIMUM_HOURS)
}

const isInRemWindow = (hour: number, temperatureMinimumHour: number) => {
  const hoursAfterMinimum = wrapHours(hour - temperatureMinimumHour)
  return hoursAfterMinimum >= REM_WINDOW_START_HOURS && hoursAfterMinimum <= REM_WINDOW_END_HOURS
}

// Decided once per session from its start, so the depth never steps mid-session
export const coolDepthForSession = (earlyCoolF: number, startHour: number, temperatureMinimumHour: number | null) => {
  if (temperatureMinimumHour === null) return Math.min(earlyCoolF, CAUTIOUS_COOL_F)
  const overlapsRemWindow = [0, 1, 2, 3].some(offset => isInRemWindow(startHour + offset, temperatureMinimumHour))
  return overlapsRemWindow ? Math.min(earlyCoolF, CAUTIOUS_COOL_F) : earlyCoolF
}
