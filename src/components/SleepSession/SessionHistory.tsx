'use client'

import { cn } from '@/lib/utils'
import { Badge, Card, SectionLabel } from '@/src/components/ds'
import { formatClock } from '@/src/lib/timeFormat'
import type { TempUnit } from '@/src/lib/tempUtils'
import { useTimeFormat } from '@/src/providers/TimeFormatProvider'
import { NightChart } from './NightChart'
import {
  collapseRamps, formatDuration, formatTemp, REASON_STYLES, STAGE_LABELS, type SessionDetail, type SleepSession,
} from './sessionFormat'

export function SessionHistory({ sessions, selectedId, onSelect, detail, unit, now }: {
  sessions?: SleepSession[]
  selectedId?: number
  onSelect: (id: number) => void
  detail?: SessionDetail
  unit: TempUnit
  now: number
}) {
  const timeFormat = useTimeFormat()
  const clock = (seconds: number) => formatClock(seconds * 1000, timeFormat)
  const title = (session: SleepSession) => {
    const day = new Date(session.startedAt * 1000).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
    return `${day} · ${clock(session.startedAt)}–${session.endedAt === null ? 'now' : clock(session.endedAt)}`
  }

  if (!sessions?.length) {
    return (
      <Card>
        <p className="text-[13px] text-fg-2">No sleep sessions yet. Your first sleep will show up here with a chart of every adjustment.</p>
      </Card>
    )
  }

  return (
    <Card>
      {detail && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[15px] font-semibold text-fg">{title(detail.session)}</h3>
            {detail.session.isNap && <Badge>Nap</Badge>}
            {detail.session.dryRun && <Badge>Dry run</Badge>}
          </div>
          <NightChart detail={detail} unit={unit} now={now} />
          <div>
            <SectionLabel>Why it changed</SectionLabel>
            {collapseRamps(detail.decisions).map(({ decision, finalF }) => {
              const style = REASON_STYLES[decision.reason]
              const usesStageLabel = decision.reason === 'schedule'
              return (
                <div key={decision.id} className="flex items-center gap-2.5 border-b border-line py-2">
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: style.color }} />
                  <span className="w-16 shrink-0 font-mono text-xs text-fg-2">{clock(decision.timestamp)}</span>
                  <span className="min-w-0 flex-1 text-[13px] text-fg">{decision.detail ?? (usesStageLabel ? STAGE_LABELS[decision.stage] : style.label)}</span>
                  <span className="text-[13px] font-semibold text-fg">
                    {finalF === undefined ? formatTemp(decision.setF, unit) : `${formatTemp(decision.setF, unit)} → ${formatTemp(finalF, unit)}`}
                  </span>
                </div>
              )
            })}
          </div>
        </>
      )}
      <div>
        <SectionLabel>Recent sessions</SectionLabel>
        <div className="flex flex-col">
          {sessions.map(session => (
            <button
              key={session.id}
              type="button"
              onClick={() => onSelect(session.id)}
              className={cn(
                'flex cursor-pointer items-center justify-between gap-2 rounded-ctl px-2 py-2 text-left hover:bg-active',
                session.id === selectedId && 'bg-active',
              )}
            >
              <span className="text-[13px] text-fg">{title(session)}</span>
              <span className="shrink-0 text-xs text-fg-2">
                {`${session.isNap ? 'Nap · ' : ''}${formatDuration((session.endedAt ?? now) - session.startedAt)}`}
              </span>
            </button>
          ))}
        </div>
      </div>
    </Card>
  )
}
