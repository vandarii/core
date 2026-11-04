'use client'

import type { ReactNode } from 'react'
import { Card, SectionLabel, SettingRow, Stepper, Toggle } from '@/src/components/ds'
import type { TempUnit } from '@/src/lib/tempUtils'
import type { SessionSettings } from '@/src/sleepSession/types'
import { formatOffset, formatTemp } from './sessionFormat'

// Limits for the app's controls. The server allows 60-100°F
const SOFT_MIN_F = 65
const SOFT_MAX_F = 95

export function SessionSettingsPanel({ settings, unit, liveControlAvailable, disabled, onChange }: {
  settings: SessionSettings
  unit: TempUnit
  liveControlAvailable: boolean
  disabled: boolean
  onChange: (settings: SessionSettings) => void
}) {
  const update = (changes: Partial<SessionSettings>) => onChange({ ...settings, ...changes })
  const room = settings.roomCompensation
  const updateRoom = (changes: Partial<SessionSettings['roomCompensation']>) =>
    update({ roomCompensation: { ...room, ...changes } })

  const row = (label: string, sub: ReactNode, control: ReactNode) => (
    <SettingRow label={label} sub={sub}>{control}</SettingRow>
  )
  const temperature = (key: 'entryTemperatureF' | 'baseTemperatureF' | 'napTemperatureF', label: string) => (
    <Stepper
      label={label}
      value={settings[key]}
      min={SOFT_MIN_F}
      max={SOFT_MAX_F}
      disabled={disabled}
      format={value => formatTemp(value, unit)}
      onChange={value => update({ [key]: value })}
    />
  )

  return (
    <Card>
      <SectionLabel>General</SectionLabel>
      <SettingRow label="Autopilot" sub="A running session outranks this side's temperature schedule. Alarms still run." divider={false}>
        <Toggle label="Autopilot" on={settings.enabled} disabled={disabled} onChange={enabled => update({ enabled })} />
      </SettingRow>
      {row(
        'Dry run',
        liveControlAvailable
          ? 'Logs what Autopilot would do without changing the temperature. Applies to sessions started after the change.'
          : 'Live control isn’t connected yet, so every session is a dry run and the bed is never changed.',
        <Toggle label="Dry run" on={settings.dryRun || !liveControlAvailable} disabled={disabled || !liveControlAvailable} onChange={dryRun => update({ dryRun })} />,
      )}

      <SectionLabel className="mt-2">Temperature curve</SectionLabel>
      {row('Getting into bed', 'Held for 15 minutes, then a slow ramp down', temperature('entryTemperatureF', 'Getting into bed'))}
      {row('Base temperature', 'Where the bed settles for the rest of the sleep', temperature('baseTemperatureF', 'Base temperature'))}
      {row('Early cooling', 'Below base for about the first 3 hours', (
        <Stepper label="Early cooling" value={settings.earlyCoolF} min={0} max={10} disabled={disabled} format={value => formatOffset(-value, unit)} onChange={earlyCoolF => update({ earlyCoolF })} />
      ))}
      {row('Wake-up warm-up', 'Only with a wake time, comfort rather than alertness', (
        <Stepper label="Wake-up warm-up" value={settings.wakeRiseF} min={0} max={6} disabled={disabled} format={value => formatOffset(value, unit)} onChange={wakeRiseF => update({ wakeRiseF })} />
      ))}
      {row('Nap', undefined, temperature('napTemperatureF', 'Nap'))}
      <p className="text-xs text-fg-2">
        The bed follows a slow schedule rather than reacting to sleep stages. Early cooling is limited to 2°F until there are 4 sessions to estimate your body clock, and when REM is likely early on.
      </p>

      <SectionLabel className="mt-2">Room compensation</SectionLabel>
      <SettingRow
        label="Adjust for room temperature"
        sub="A room warmer than the reference cools the bed 1°F per °C. Below 18°C it warms a little. Off by default, because the Pod's room sensor reads unreliably while the Pod runs."
        divider={false}
      >
        <Toggle label="Adjust for room temperature" on={room.enabled} disabled={disabled} onChange={enabled => updateRoom({ enabled })} />
      </SettingRow>
      {row('Reference room temperature', undefined, (
        <Stepper label="Reference room temperature" value={room.referenceC} step={0.5} min={10} max={35} disabled={disabled || !room.enabled} format={value => `${value.toFixed(1)}°C`} onChange={referenceC => updateRoom({ referenceC })} />
      ))}
      {row('Sensor calibration', 'Added to the Pod’s room reading', (
        <Stepper label="Sensor calibration" value={room.calibrationOffsetC} step={0.5} min={-10} max={10} disabled={disabled || !room.enabled} format={value => `${value > 0 ? '+' : ''}${value.toFixed(1)}°C`} onChange={calibrationOffsetC => updateRoom({ calibrationOffsetC })} />
      ))}

      <SectionLabel className="mt-2">Limits and safety</SectionLabel>
      {row('Max adjustment', 'How far a warm room can move the bed from the curve', (
        <Stepper label="Max adjustment" value={settings.maxAdjustmentF} min={0} max={10} disabled={disabled} format={value => formatOffset(value, unit).replace('+', '±')} onChange={maxAdjustmentF => update({ maxAdjustmentF })} />
      ))}
      {row('Min time between changes', undefined, (
        <Stepper label="Min time between changes" value={settings.minMinutesBetweenChanges} step={5} min={5} max={120} disabled={disabled} format={value => `${value} min`} onChange={minMinutesBetweenChanges => update({ minMinutesBetweenChanges })} />
      ))}
      {row('End when out of bed for', 'The session end is set back to when you got up', (
        <Stepper label="End when out of bed for" value={settings.autoEndAbsentMinutes} step={10} min={10} max={240} disabled={disabled} format={value => `${value} min`} onChange={autoEndAbsentMinutes => update({ autoEndAbsentMinutes })} />
      ))}
      {row('Max session length', undefined, (
        <Stepper label="Max session length" value={settings.maxSessionHours} min={2} max={24} disabled={disabled} format={value => `${value} h`} onChange={maxSessionHours => update({ maxSessionHours })} />
      ))}
      {row('Count as a nap if shorter than', undefined, (
        <Stepper label="Count as a nap if shorter than" value={settings.napMaxMinutes} step={10} min={0} max={240} disabled={disabled} format={value => `${value} min`} onChange={napMaxMinutes => update({ napMaxMinutes })} />
      ))}
    </Card>
  )
}
