import type { inferRouterOutputs } from '@trpc/server'
import type { AppRouter } from '@/src/server/routers/app'
import type { TempUnit } from '@/src/lib/tempUtils'
import type { DecisionReason, SessionStage } from '@/src/sleepSession/types'

type Outputs = inferRouterOutputs<AppRouter>['sleepSessions']
export type SessionSideStatus = Outputs['getStatus']['left']
export type SleepSession = Outputs['list'][number]
export type SessionDetail = Outputs['getDetail']
export type SessionDecision = SessionDetail['decisions'][number]

export const STAGE_LABELS: Record<SessionStage, string> = {
  entry: 'Getting into bed',
  cooling: 'Early cooling',
  easing: 'Easing to base',
  steady: 'Steady',
  wake: 'Wake-up',
}

export const SHORT_STAGE_LABELS: Record<SessionStage, string> = {
  entry: 'Entry',
  cooling: 'Cool',
  easing: 'Ease',
  steady: 'Steady',
  wake: 'Wake',
}

// Each reason gets a colour and a shape, so the chart doesn't rely on colour alone
export const REASON_STYLES: Record<DecisionReason, { label: string, color: string, shape: 'circle' | 'diamond' | 'square' | 'triangle' }> = {
  schedule: { label: 'Schedule change', color: 'var(--text-3)', shape: 'circle' },
  room: { label: 'Room temperature', color: 'var(--status-ok)', shape: 'diamond' },
  wake: { label: 'Wake warm-up', color: 'var(--accent-warm)', shape: 'triangle' },
  nap: { label: 'Nap', color: 'var(--accent-cool)', shape: 'square' },
}

const END_REASON_LABELS: Record<NonNullable<SleepSession['endReason']>, string> = {
  out_of_bed: 'you were out of bed',
  max_length: 'it reached the maximum length',
  tap: 'of a triple tap',
  manual: 'it was ended from the app',
  api: 'it was ended from another device',
}

export const endReasonLabel = (reason: SleepSession['endReason']) => (reason ? END_REASON_LABELS[reason] : 'it was ended')

export const toUnit = (temperatureF: number, unit: TempUnit) => (unit === 'C' ? (temperatureF - 32) * 5 / 9 : temperatureF)

export const formatTemp = (temperatureF: number | null | undefined, unit: TempUnit) => {
  if (temperatureF === null || temperatureF === undefined) return '—'
  return unit === 'C' ? `${toUnit(temperatureF, 'C').toFixed(1)}°C` : `${Math.round(temperatureF)}°F`
}

// Offsets are stored in °F. Show them as a signed change in the user's unit
export const formatOffset = (offsetF: number, unit: TempUnit) => {
  const value = unit === 'C' ? Math.round((offsetF * 5 / 9) * 2) / 2 : offsetF
  const sign = value > 0 ? '+' : value < 0 ? '−' : '±'
  return `${sign}${Math.abs(value)}°${unit}`
}

export const formatRoom = (roomC: number | null | undefined, unit: TempUnit) => {
  if (roomC === null || roomC === undefined) return '—'
  return unit === 'C' ? `${roomC.toFixed(1)}°C` : `${Math.round(roomC * 9 / 5 + 32)}°F`
}

export const formatDuration = (seconds: number) => {
  const totalMinutes = Math.max(0, Math.round(seconds / 60))
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return hours > 0 ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m`
}

export const formatHour = (hour: number) => {
  const totalMinutes = Math.round(hour * 60) % (24 * 60)
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, '0')}:${String(totalMinutes % 60).padStart(2, '0')}`
}

/** Next occurrence of an HH:mm wake time, as unix seconds */
export const nextWakeAt = (time: string, now = new Date()) => {
  const [hours, minutes] = time.split(':').map(Number)
  const wake = new Date(now)
  wake.setHours(hours, minutes, 0, 0)
  if (wake <= now) wake.setDate(wake.getDate() + 1)
  return Math.floor(wake.getTime() / 1000)
}

export interface DecisionRowData {
  decision: SessionDecision
  /** Last temperature of a collapsed ramp */
  finalF?: number
}

// Ramps log one decision per degree, so each ramp shows as a single row with its final temperature
export const collapseRamps = (decisions: SessionDecision[]): DecisionRowData[] => {
  const rows: DecisionRowData[] = []
  for (const decision of decisions) {
    const last = rows.at(-1)
    const isRampStep = decision.reason === 'wake' || (decision.reason === 'schedule' && !decision.detail)
    if (isRampStep && last?.decision.reason === decision.reason && last.decision.stage === decision.stage) {
      last.finalF = decision.setF
      continue
    }
    rows.push({ decision })
  }
  return rows
}
