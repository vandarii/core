'use client'

import { cn } from '@/lib/utils'
import { SectionLabel } from '@/src/components/ds'
import type { TempUnit } from '@/src/lib/tempUtils'
import { CAUTIOUS_COOL_F } from '@/src/sleepSession/bodyClock'
import { WAKE_MAX_ABOVE_BASE_F, WAKE_MAX_F } from '@/src/sleepSession/curve'
import type { SessionSettings, SessionStage } from '@/src/sleepSession/types'
import { formatHour, formatTemp, type SessionSideStatus } from './sessionFormat'

export function TemperaturePlan({ settings, bodyClock, stage, unit }: {
  settings: SessionSettings
  bodyClock?: SessionSideStatus['bodyClock']
  stage?: SessionStage | null
  unit: TempUnit
}) {
  const { baseTemperatureF: baseF, earlyCoolF, entryTemperatureF: entryF, wakeRiseF } = settings
  const minimumHour = bodyClock?.temperatureMinimumHour ?? null
  const coolDepthF = minimumHour === null ? Math.min(earlyCoolF, CAUTIOUS_COOL_F) : earlyCoolF
  const steps: Array<{ label: string, temperatureF: number, stages: SessionStage[] }> = [
    { label: 'Get in', temperatureF: entryF, stages: ['entry'] },
    { label: 'Early', temperatureF: baseF - coolDepthF, stages: ['cooling'] },
    { label: 'Later', temperatureF: baseF, stages: ['easing', 'steady'] },
    { label: 'Wake', temperatureF: Math.min(baseF + wakeRiseF, WAKE_MAX_F, baseF + WAKE_MAX_ABOVE_BASE_F), stages: ['wake'] },
  ]

  return (
    <section className="flex flex-col gap-2">
      <SectionLabel>The plan</SectionLabel>
      <div className="grid grid-cols-4 gap-2">
        {steps.map(step => (
          <div
            key={step.label}
            className={cn(
              'flex min-w-0 flex-col items-center rounded-ctl border p-2.5',
              stage && step.stages.includes(stage) ? 'border-fg' : 'border-line',
            )}
          >
            <span className="text-xs text-fg-2">{step.label}</span>
            <span className="text-[17px] font-semibold text-fg">{formatTemp(step.temperatureF, unit)}</span>
          </div>
        ))}
      </div>
      {bodyClock && (
        <p className="text-xs text-fg-2">
          {minimumHour === null
            ? `Learning your body clock: ${bodyClock.sessionCount} of ${bodyClock.sessionsNeeded} sessions`
            : `Body clock estimate: coldest point around ${formatHour(minimumHour)}, give or take 2-3 hours`}
        </p>
      )}
    </section>
  )
}
