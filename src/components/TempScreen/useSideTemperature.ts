'use client'

import { useCallback, useEffect, useRef } from 'react'
import { trpc } from '@/src/utils/trpc'
import { useOptimisticValue } from '@/src/hooks/useOptimisticValue'
import type { Side } from '@/src/providers/SideProvider'

interface SideStatus {
  currentTemperature: number | null
  mattressTemperature?: number | null
  powerOnTemperature?: number | null
  targetTemperature: number | null
  targetLevel: number
}

export interface SideTemperature {
  side: Side
  /** Optimistic target set point, °F. While off, where the side goes when turned on. */
  targetF: number
  /** Measured mattress temperature, °F (null while the surface sensors are missing or stale). */
  bedF: number | null
  /** Water temperature, °F. The bed lags it, so this alone decides warming vs cooling. */
  waterF: number | null
  isOn: boolean
  tempPending: boolean
  powerPending: boolean
  /** Visual-only drag update — no hardware call. */
  preview: (f: number) => void
  /** Send a set point, holding it on screen until the status stream confirms it. */
  commitTemp: (f: number) => void
  /** −/+ taps: show the value now, send one set point once taps pause. */
  stepTemp: (f: number) => void
  commitPower: (on: boolean) => void
}

/** Where a side with nothing else to go on starts; matches the server. */
const POWER_ON_DEFAULT_F = 75

/** −/+ taps within this window pool into one setTemperature. */
const STEP_COMMIT_DELAY_MS = 500

/**
 * One side's target/power with optimistic overrides. The visible status is
 * WS-preferred (~2s cadence), so clearing local state in onSettled would snap
 * the control back to the stale value; useOptimisticValue holds the local
 * value until the server reports it (or a timeout gives up).
 */
export function useSideTemperature(
  side: Side,
  sideStatus: SideStatus | undefined,
  holdMinutes: number,
  refetch: () => unknown,
  /** A notice blocks this side: a −/+ step still waiting to send is dropped. */
  blocked = false,
): SideTemperature {
  const setTempMutation = trpc.device.setTemperature.useMutation()
  const setPowerMutation = trpc.device.setPower.useMutation()
  const setPowerOnMutation = trpc.device.setPowerOnTemperature.useMutation()

  const targetOpt = useOptimisticValue(sideStatus?.targetTemperature ?? sideStatus?.powerOnTemperature ?? POWER_ON_DEFAULT_F)
  const powerOpt = useOptimisticValue((sideStatus?.targetLevel ?? 0) !== 0)
  const { preview: previewTarget, commit: commitTarget, discard: discardTarget } = targetOpt
  const { commit: commitPowerOpt, discard: discardPower } = powerOpt
  const { mutate: mutateTemp } = setTempMutation
  const { mutate: mutatePower } = setPowerMutation
  const { mutate: mutatePowerOn } = setPowerOnMutation
  // The latest intent, not the last render: linking powers a side and sets it in the same tick.
  const intendedOn = useRef(powerOpt.value)
  useEffect(() => {
    intendedOn.current = powerOpt.value
  }, [powerOpt.value])

  const commitTemp = useCallback((f: number) => {
    commitTarget(f)
    // An off side only remembers the value: setTemperature would switch it on.
    if (!intendedOn.current) {
      mutatePowerOn({ side, temperature: f }, { onError: () => discardTarget() })
      return
    }
    mutateTemp(
      // 30 min is the server default; only send an explicit override.
      { side, temperature: f, ...(holdMinutes === 30 ? {} : { holdMinutes }) },
      {
        onSettled: () => { void refetch() },
        onError: () => discardTarget(),
      },
    )
  }, [side, holdMinutes, refetch, commitTarget, discardTarget, mutateTemp, mutatePowerOn])

  const stepTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingStepF = useRef<number | null>(null)
  useEffect(() => () => {
    if (stepTimer.current) clearTimeout(stepTimer.current)
  }, [])

  useEffect(() => {
    if (!blocked || !stepTimer.current) return
    clearTimeout(stepTimer.current)
    stepTimer.current = null
    discardTarget()
  }, [blocked, discardTarget])

  const stepTemp = useCallback((f: number) => {
    previewTarget(f)
    pendingStepF.current = f
    if (stepTimer.current) clearTimeout(stepTimer.current)
    stepTimer.current = setTimeout(() => {
      stepTimer.current = null
      commitTemp(f)
    }, STEP_COMMIT_DELAY_MS)
  }, [previewTarget, commitTemp])

  const commitPower = useCallback((on: boolean) => {
    commitPowerOpt(on)
    intendedOn.current = on
    // −/+ taps still waiting to send: power on straight to them.
    const pendingF = on && stepTimer.current ? pendingStepF.current : null
    if (pendingF !== null && stepTimer.current) {
      clearTimeout(stepTimer.current)
      stepTimer.current = null
      commitTarget(pendingF)
      mutatePowerOn({ side, temperature: pendingF })
    }
    mutatePower(
      { side, powered: on, ...(pendingF !== null && { temperature: pendingF }) },
      {
        onSettled: () => { void refetch() },
        onError: () => discardPower(),
      },
    )
  }, [side, refetch, commitPowerOpt, commitTarget, discardPower, mutatePower, mutatePowerOn])

  return {
    side,
    targetF: targetOpt.value,
    bedF: sideStatus?.mattressTemperature ?? null,
    waterF: sideStatus?.currentTemperature ?? null,
    isOn: powerOpt.value,
    tempPending: setTempMutation.isPending,
    powerPending: setPowerMutation.isPending,
    preview: previewTarget,
    commitTemp,
    stepTemp,
    commitPower,
  }
}
