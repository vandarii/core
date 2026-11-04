'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Moon, X } from 'lucide-react'
import { Alert, Badge, Button, Card, GhostIcon, InlineError, KeyValue, StatusDot } from '@/src/components/ds'
import { formatClock } from '@/src/lib/timeFormat'
import type { TempUnit } from '@/src/lib/tempUtils'
import { useTimeFormat } from '@/src/providers/TimeFormatProvider'
import type { SessionSettings, Side } from '@/src/sleepSession/types'
import { trpc } from '@/src/utils/trpc'
import {
  endReasonLabel, formatDuration, formatRoom, formatTemp, nextWakeAt, STAGE_LABELS, type SessionSideStatus,
} from './sessionFormat'

export function SessionCard({ side, status, settings, unit, now, settingsHref, onChanged }: {
  side: Side
  status?: SessionSideStatus
  settings?: SessionSettings
  unit: TempUnit
  now: number
  settingsHref: string
  onChanged: () => void
}) {
  const timeFormat = useTimeFormat()
  const clock = (seconds: number) => formatClock(seconds * 1000, timeFormat)
  const [wakeTime, setWakeTime] = useState('')

  const options = { onSuccess: onChanged }
  const start = trpc.sleepSessions.start.useMutation(options)
  const end = trpc.sleepSessions.end.useMutation(options)
  const resume = trpc.sleepSessions.resume.useMutation(options)
  const prepare = trpc.sleepSessions.prepare.useMutation(options)
  const mutations = [start, end, resume, prepare]
  const busy = mutations.some(mutation => mutation.isPending)
  const error = mutations.find(mutation => mutation.error)?.error?.message

  const session = status?.session
  const enabled = status?.enabled ?? false

  if (!session) {
    const lastSession = status?.lastSession
    const begin = (nap: boolean) => start.mutate({
      side,
      nap,
      ...(wakeTime && !nap ? { wakeAt: nextWakeAt(wakeTime) } : {}),
    })
    return (
      <Card>
        <div className="flex flex-col items-center gap-1 py-1 text-center">
          <Moon size={28} className="text-cool" aria-hidden />
          <h2 className="text-lg font-semibold text-fg">Ready when you are</h2>
          <p className="max-w-[420px] text-[13px] text-fg-2">
            Autopilot follows a slow temperature curve during a sleep session. Start one when you get into bed.
          </p>
        </div>

        {!enabled && (
          <Alert>
            Autopilot is off for this side. Turn it on in
            {' '}
            <Link href={settingsHref} className="underline">Settings</Link>
            .
          </Alert>
        )}

        {status?.canResume && lastSession?.endedAt != null && (
          <Alert action={<Button size="sm" disabled={busy} onClick={() => resume.mutate({ side })}>Resume</Button>}>
            {`Your session ended at ${clock(lastSession.endedAt)} because ${endReasonLabel(lastSession.endReason)}.`}
          </Alert>
        )}

        <label className="flex flex-col gap-1 text-xs text-fg-2">
          Wake me at (optional)
          <span className="flex items-center gap-2">
            <input
              type="time"
              value={wakeTime}
              disabled={busy || !enabled}
              onChange={event => setWakeTime(event.target.value)}
              className="min-w-0 flex-1 rounded-ctl border border-line-2 bg-transparent px-3 py-2 font-mono text-sm text-fg disabled:opacity-50"
            />
            {wakeTime && <GhostIcon icon={X} label="Clear wake time" onClick={() => setWakeTime('')} />}
          </span>
          <span className="text-fg-3">
            {wakeTime ? 'The bed warms up over the last 30 minutes before this time' : 'Leave empty to sleep without a wake-up warm-up'}
          </span>
        </label>

        <Button variant="primary" full disabled={busy || !enabled} onClick={() => begin(false)}>Start sleep</Button>
        <Button full disabled={busy || !enabled} onClick={() => begin(true)}>Start nap</Button>
        {enabled && !status?.dryRun && (
          <Button full disabled={busy} onClick={() => prepare.mutate({ side })}>Get bed ready</Button>
        )}
        {error && <InlineError>{error}</InlineError>}
      </Card>
    )
  }

  const absentSince = status?.absentSince
  const autoEndAt = absentSince != null && settings
    ? Math.max(absentSince, session.startedAt) + settings.autoEndAbsentMinutes * 60
    : null
  const lastDecision = status?.lastDecision

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-2">
        <StatusDot tone="ok" label={`${session.isNap ? 'Napping' : 'Sleeping'} · ${formatDuration(now - session.startedAt)}`} />
        {session.dryRun && <span className="ml-auto"><Badge>Dry run</Badge></span>}
      </div>

      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs text-fg-2">{session.isNap ? 'Nap' : STAGE_LABELS[status?.stage ?? 'entry']}</p>
          <p className="text-[44px] leading-tight font-semibold tracking-tight text-fg">{formatTemp(status?.setF, unit)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-fg-2">Scheduled</p>
          <p className="text-cool">{formatTemp(status?.stageTargetF, unit)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <KeyValue label={status?.roomSource === 'external' ? 'Room (room sensor)' : 'Room (Pod sensor)'} value={formatRoom(status?.roomC, unit)} />
        <KeyValue label="Humidity" value={status?.humidity == null ? '—' : `${Math.round(status.humidity)}%`} />
      </div>

      {lastDecision && (
        <div className="rounded-ctl border border-line p-3">
          <p className="text-[13px] text-fg">
            {`${session.dryRun ? 'Would set' : 'Set'} ${formatTemp(lastDecision.setF, unit)} at ${clock(lastDecision.timestamp)}`}
          </p>
          <p className="text-xs text-fg-2">{lastDecision.detail ?? STAGE_LABELS[lastDecision.stage]}</p>
        </div>
      )}

      {autoEndAt !== null && absentSince != null && (
        <Alert>
          {`Out of bed since ${clock(absentSince)}. The session ends automatically at ${clock(autoEndAt)} unless you come back.`}
        </Alert>
      )}

      {session.wakeAt !== null && (
        <p className="text-center text-[13px] text-fg-2">
          {`Wake at ${clock(session.wakeAt)} · warm-up starts ${clock(session.wakeAt - 30 * 60)}`}
        </p>
      )}

      <Button full disabled={busy} onClick={() => end.mutate({ side })}>End sleep</Button>
      {error && <InlineError>{error}</InlineError>}
    </Card>
  )
}
