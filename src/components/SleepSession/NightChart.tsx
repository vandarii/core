'use client'

import { useMemo } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AXIS_TICK, TOOLTIP_LABEL_STYLE, TOOLTIP_STYLE } from '@/src/components/Sensors/chartTheme'
import { formatClock } from '@/src/lib/timeFormat'
import type { TempUnit } from '@/src/lib/tempUtils'
import { useTimeFormat } from '@/src/providers/TimeFormatProvider'
import type { DecisionReason } from '@/src/sleepSession/types'
import { REASON_STYLES, SHORT_STAGE_LABELS, toUnit, type SessionDetail } from './sessionFormat'

const round = (value: number) => Math.round(value * 10) / 10

function Marker({ reason, cx, cy }: { reason: DecisionReason, cx: number, cy: number }) {
  const { color, shape } = REASON_STYLES[reason]
  if (shape === 'diamond') return <path d={`M${cx},${cy - 5}L${cx + 5},${cy}L${cx},${cy + 5}L${cx - 5},${cy}Z`} fill={color} />
  if (shape === 'triangle') return <path d={`M${cx},${cy - 5}L${cx + 5},${cy + 4}L${cx - 5},${cy + 4}Z`} fill={color} />
  if (shape === 'square') return <rect x={cx - 4} y={cy - 4} width={8} height={8} fill={color} />
  return <circle cx={cx} cy={cy} r={4} fill={color} />
}

export function NightChart({ detail, unit, now }: { detail: SessionDetail, unit: TempUnit, now: number }) {
  const timeFormat = useTimeFormat()
  const { session, decisions } = detail
  const endTime = session.endedAt ?? now

  const chart = useMemo(() => {
    const points = decisions.map((decision, index) => {
      // Ramps step one degree at a time, so only their first step gets a marker
      const isRampStep = decision.reason === 'wake' || decision.reason === 'schedule'
      const marked = index === 0 || !isRampStep || decision.stage !== decisions[index - 1].stage
      return {
        time: decision.timestamp,
        set: round(toUnit(decision.setF, unit)),
        target: round(toUnit(decision.targetF, unit)),
        marker: marked ? decision.reason : null,
      }
    })
    const last = points.at(-1)
    if (last) points.push({ ...last, time: endTime, marker: null })
    const stageChanges = decisions.filter((decision, index) => index > 0 && decision.stage !== decisions[index - 1].stage)
    return { points, stageChanges }
  }, [decisions, endTime, unit])

  if (decisions.length === 0) {
    return <p className="py-8 text-center text-[13px] text-fg-2">No decisions logged for this session yet.</p>
  }

  const clock = (seconds: number) => formatClock(seconds * 1000, timeFormat)

  return (
    <div className="flex flex-col gap-2">
      <div
        className="h-[240px] w-full"
        role="img"
        aria-label={`Bed temperature from ${clock(session.startedAt)} to ${clock(endTime)}, ${decisions.length} decisions`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chart.points} margin={{ top: 22, right: 28, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="var(--border-grid)" vertical={false} />
            <XAxis
              dataKey="time"
              type="number"
              domain={[session.startedAt, endTime]}
              tick={AXIS_TICK}
              tickFormatter={clock}
              tickCount={4}
              stroke="var(--border-1)"
            />
            <YAxis
              tick={AXIS_TICK}
              stroke="var(--border-1)"
              domain={[(min: number) => Math.floor(min - 2), (max: number) => Math.ceil(max + 2)]}
              tickFormatter={value => `${value}°`}
              allowDecimals={false}
            />
            <Tooltip
              contentStyle={TOOLTIP_STYLE}
              labelStyle={TOOLTIP_LABEL_STYLE}
              labelFormatter={value => clock(Number(value))}
              formatter={(value, name) => [`${String(value)}°${unit}`, name === 'set' ? 'Set' : 'Schedule']}
            />
            {chart.stageChanges.map(decision => (
              <ReferenceLine
                key={decision.id}
                x={decision.timestamp}
                stroke="var(--accent-cool)"
                strokeOpacity={0.5}
                label={{ value: SHORT_STAGE_LABELS[decision.stage], position: 'top', fill: 'var(--text-2)', fontSize: 10 }}
              />
            ))}
            <Line dataKey="target" type="stepAfter" stroke="var(--text-3)" strokeWidth={1.3} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
            <Line
              dataKey="set"
              type="stepAfter"
              stroke="var(--text-1)"
              strokeWidth={2}
              isAnimationActive={false}
              dot={({ key, cx, cy, payload }) => {
                const marker = (payload as { marker: DecisionReason | null } | undefined)?.marker
                if (!marker || cx === undefined || cy === undefined) return <g key={key} />
                return <Marker key={key} reason={marker} cx={cx} cy={cy} />
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-fg-2">
        <span className="flex items-center gap-1">
          <span className="w-3.5 border-t-[1.5px] border-dashed border-fg-3" />
          Schedule
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3.5 border-t-2 border-fg" />
          Set temperature
        </span>
        {(Object.keys(REASON_STYLES) as DecisionReason[]).map(reason => (
          <span key={reason} className="flex items-center gap-1">
            <svg width={12} height={12} aria-hidden="true"><Marker reason={reason} cx={6} cy={6} /></svg>
            {REASON_STYLES[reason].label}
          </span>
        ))}
      </div>
    </div>
  )
}
