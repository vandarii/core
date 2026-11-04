'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { langFromPath } from '@/src/components/AppShell/navItems'
import { PageHeader, SectionLabel, SegmentedControl, Skeleton } from '@/src/components/ds'
import { useDocumentTitle } from '@/src/hooks/useDocumentTitle'
import { useSideNames } from '@/src/hooks/useSideNames'
import { useTemperatureUnit } from '@/src/hooks/useTemperatureUnit'
import { useShownSides } from '@/src/providers/SideProvider'
import type { SessionSettings, Side } from '@/src/sleepSession/types'
import { trpc } from '@/src/utils/trpc'
import { SessionCard } from './SessionCard'
import { SessionHistory } from './SessionHistory'
import { SessionSettingsPanel } from './SessionSettingsPanel'
import { resolveSessionView, SESSION_VIEWS, type SessionView } from './sessionViews'
import { TemperaturePlan } from './TemperaturePlan'

const REFRESH_MS = 30_000

const useNowSeconds = () => {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), REFRESH_MS)
    return () => clearInterval(timer)
  }, [])
  return now
}

export function SleepSessionPage() {
  const shownSides = useShownSides()
  const { sideName } = useSideNames()
  const { unit } = useTemperatureUnit()
  const utils = trpc.useUtils()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const lang = langFromPath(pathname)
  const view = resolveSessionView(searchParams.get('view'))
  const viewLabel = SESSION_VIEWS.find(item => item.id === view)?.label
  useDocumentTitle(viewLabel, 'Autopilot')
  const setView = useCallback((next: SessionView) => {
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'sleep') params.delete('view')
    else params.set('view', next)
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [pathname, router, searchParams])
  const now = useNowSeconds()
  const [side, setSide] = useState<Side>(shownSides[0] ?? 'right')
  const [picked, setPicked] = useState<{ side: Side, id: number } | null>(null)

  const statusQ = trpc.sleepSessions.getStatus.useQuery({}, { refetchInterval: REFRESH_MS })
  const settingsQ = trpc.sleepSessions.getSettings.useQuery({ side })
  const sessionsQ = trpc.sleepSessions.list.useQuery({ side, limit: 14 }, { refetchInterval: REFRESH_MS })
  // A different side has different sessions
  const selectedId = (picked?.side === side ? picked.id : undefined) ?? sessionsQ.data?.[0]?.id
  const detailQ = trpc.sleepSessions.getDetail.useQuery(
    { id: selectedId ?? 0 },
    { enabled: selectedId !== undefined, refetchInterval: REFRESH_MS },
  )

  const refresh = () => {
    void utils.sleepSessions.getStatus.invalidate()
    void utils.sleepSessions.list.invalidate()
    void utils.sleepSessions.getDetail.invalidate()
  }

  const saveSettings = trpc.sleepSessions.updateSettings.useMutation({ onSettled: refresh })
  const changeSettings = (settings: SessionSettings) => {
    // Show the change at once, so quick taps on a stepper build on each other
    utils.sleepSessions.getSettings.setData({ side }, settings)
    saveSettings.mutate({ side, settings })
  }

  const status = statusQ.data?.[side]
  const settings = settingsQ.data
  const detail = detailQ.data?.session.side === side ? detailQ.data : undefined

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4">
      <span className="-mb-2 hidden font-mono text-[13px] text-fg-2 min-[900px]:block">Autopilot /</span>
      <PageHeader
        title={(
          <>
            <span className="min-[900px]:hidden">Autopilot</span>
            <span className="hidden min-[900px]:inline">{viewLabel}</span>
          </>
        )}
        right={(
          <SegmentedControl
            ariaLabel="Autopilot view"
            size="sm"
            className="min-[900px]:hidden"
            value={view}
            onChange={setView}
            options={SESSION_VIEWS.map(item => ({ value: item.id, label: item.label }))}
          />
        )}
      />
      {shownSides.length > 1 && (
        <SegmentedControl
          full
          value={side}
          onChange={setSide}
          options={shownSides.map(value => ({ value, label: sideName(value) }))}
        />
      )}

      {view === 'settings'
        ? settings
          ? (
              <SessionSettingsPanel
                settings={settings}
                unit={unit}
                liveControlAvailable={status?.liveControlAvailable ?? false}
                disabled={false}
                onChange={changeSettings}
              />
            )
          : <Skeleton className="h-64" />
        : (
            <>
              {statusQ.isLoading
                ? <Skeleton className="h-64" />
                : (
                    <SessionCard
                      side={side}
                      status={status}
                      settings={settings}
                      unit={unit}
                      now={now}
                      settingsHref={`/${lang}/sessions?view=settings`}
                      onChanged={refresh}
                    />
                  )}

              {settings && <TemperaturePlan settings={settings} bodyClock={status?.bodyClock} stage={status?.stage} unit={unit} />}

              <section className="flex flex-col gap-2">
                <SectionLabel>Nights</SectionLabel>
                <SessionHistory
                  sessions={sessionsQ.data}
                  selectedId={selectedId}
                  onSelect={id => setPicked({ side, id })}
                  detail={detail}
                  unit={unit}
                  now={now}
                />
              </section>

              <Link href={`/${lang}/autopilot`} className="text-center text-[13px] text-fg-2 underline">
                Rules for water alerts and other automations
              </Link>
            </>
          )}
    </div>
  )
}
