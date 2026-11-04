import assert from 'node:assert/strict'
import { beforeEach, test } from 'vitest'
import {
  clampTemperatureF,
  describeDecision,
  planTemperature,
  resolveRoom,
  roomAdjustmentF,
  scheduleAt,
  shouldApply,
  wakeRampF,
  type TemperaturePlan,
} from '../curve'
import { CAUTIOUS_COOL_F, coolDepthForSession, estimateTemperatureMinimumHour } from '../bodyClock'
import { getAbsentSince, recordPresence, resetPresence } from '../presenceTracker'
import type { DecisionReason, SessionSettings } from '../types'

const START = 1_762_200_000
const minutes = (count: number) => count * 60

const settings = (): SessionSettings => ({
  enabled: true,
  dryRun: true,
  baseTemperatureF: 72,
  entryTemperatureF: 76,
  earlyCoolF: 3,
  wakeRiseF: 4,
  napTemperatureF: 72,
  maxAdjustmentF: 4,
  minMinutesBetweenChanges: 20,
  autoEndAbsentMinutes: 60,
  maxSessionHours: 14,
  napMaxMinutes: 90,
  roomCompensation: { enabled: true, referenceC: 20, calibrationOffsetC: 0 },
})

const at = (elapsedMinutes: number, coolDepthF = 3) =>
  scheduleAt({ settings: settings(), startedAt: START, now: START + minutes(elapsedMinutes), coolDepthF })

test('the curve holds the entry temperature, ramps down, holds, then eases to base', () => {
  assert.deepEqual(at(0), { stage: 'entry', temperatureF: 76 })
  assert.deepEqual(at(14), { stage: 'entry', temperatureF: 76 })
  assert.equal(at(15).stage, 'cooling')
  assert.equal(at(15).temperatureF, 76)
  // 76 -> 69 at 7.5 minutes per degree ends 52.5 minutes after the hold
  assert.deepEqual(at(68), { stage: 'cooling', temperatureF: 69 })
  assert.deepEqual(at(189), { stage: 'cooling', temperatureF: 69 })
  assert.equal(at(190).stage, 'easing')
  assert.deepEqual(at(280), { stage: 'steady', temperatureF: 72 })
  assert.deepEqual(at(600), { stage: 'steady', temperatureF: 72 })
})

test('the curve never moves faster than one degree per 7.5 minutes', () => {
  for (let elapsed = 0; elapsed < 600; elapsed++) {
    assert.ok(Math.abs(at(elapsed + 7.5).temperatureF - at(elapsed).temperatureF) <= 1 + 1e-9, `at minute ${elapsed}`)
  }
})

test('cautious cooling stops higher', () => {
  assert.equal(at(120, 2).temperatureF, 70)
})

test('temperatures stay inside the in-bed limits', () => {
  assert.equal(clampTemperatureF(55), 60)
  assert.equal(clampTemperatureF(110), 100)
})

test('the wake ramp rises from the curve, stops at the wake time and is capped', () => {
  const input = { settings: settings(), startedAt: START, coolDepthF: 3 }
  const wakeAt = START + minutes(480)
  assert.equal(wakeRampF({ ...input, now: wakeAt - minutes(30) }, wakeAt), 72)
  assert.equal(wakeRampF({ ...input, now: wakeAt - minutes(15) }, wakeAt), 74)
  assert.equal(wakeRampF({ ...input, now: wakeAt }, wakeAt), 76)
  assert.equal(wakeRampF({ ...input, now: wakeAt + minutes(10) }, wakeAt), 76)
  const warmBase = { ...settings(), baseTemperatureF: 79, entryTemperatureF: 79 }
  assert.equal(wakeRampF({ ...input, settings: warmBase, now: wakeAt }, wakeAt), 80)
})

test('room compensation reacts to heat and barely to cold', () => {
  const config = settings()
  assert.equal(roomAdjustmentF(config, 19.5), 0)
  assert.equal(roomAdjustmentF(config, 20.8), 0)
  assert.equal(roomAdjustmentF(config, 23), -3)
  assert.equal(roomAdjustmentF(config, 30), -4)
  assert.equal(roomAdjustmentF(config, 18.5), 0)
  assert.equal(roomAdjustmentF(config, 16), 1)
  assert.equal(roomAdjustmentF(config, 10), 2)
  assert.equal(roomAdjustmentF(config, null), 0)
  config.roomCompensation.enabled = false
  assert.equal(roomAdjustmentF(config, 30), 0)
})

test('a fresh external sensor wins, then the hub, then the cover', () => {
  const config = settings()
  config.roomCompensation.calibrationOffsetC = -1.5
  const reading = { hubAmbC: 24, coverAmbC: 26 }
  assert.deepEqual(resolveRoom(reading, 19.8, config), { roomC: 19.8, source: 'external' })
  assert.deepEqual(resolveRoom(reading, null, config), { roomC: 22.5, source: 'pod' })
  assert.deepEqual(resolveRoom({ ...reading, hubAmbC: null }, null, config), { roomC: 24.5, source: 'pod' })
  assert.deepEqual(resolveRoom(null, null, config), { roomC: null, source: null })
})

test('plans explain why the temperature is what it is', () => {
  const input = { settings: settings(), startedAt: START, now: START + minutes(120), coolDepthF: 3, isNap: false }
  const normal = planTemperature({ ...input, roomC: 20 })
  assert.deepEqual([normal.stage, normal.desiredF, normal.reason], ['cooling', 69, 'schedule'])

  const warmRoom = planTemperature({ ...input, roomC: 23 })
  assert.deepEqual([warmRoom.stageTargetF, warmRoom.desiredF, warmRoom.reason], [69, 66, 'room'])

  const nap = planTemperature({ ...input, isNap: true, roomC: 23 })
  assert.deepEqual([nap.desiredF, nap.reason], [72, 'nap'])

  const waking = planTemperature({ ...input, now: START + minutes(470), wakeAt: START + minutes(480), roomC: 23 })
  assert.equal(waking.reason, 'wake')
})

test('schedule steps apply at once but room changes are rate limited', () => {
  const now = START + minutes(60)
  const roomPlan: TemperaturePlan = { stage: 'cooling', stageTargetF: 69, desiredF: 67, reason: 'room', detail: null }
  const base = { lastTargetF: 69, lastSetF: 69, now, minMinutesBetweenChanges: 20 }
  assert.equal(shouldApply({ ...base, plan: roomPlan, lastChangeAt: now - minutes(5) }), false)
  assert.equal(shouldApply({ ...base, plan: roomPlan, lastChangeAt: now - minutes(20) }), true)
  assert.equal(shouldApply({ ...base, plan: { ...roomPlan, desiredF: 69 }, lastChangeAt: now - minutes(60) }), false)
  const step: TemperaturePlan = { stage: 'easing', stageTargetF: 70, desiredF: 70, reason: 'schedule', detail: null }
  assert.equal(shouldApply({ ...base, plan: step, lastChangeAt: now - minutes(1) }), true)
  assert.equal(shouldApply({ ...base, lastTargetF: null, lastSetF: null, plan: roomPlan, lastChangeAt: null }), true)
})

test('logged reasons describe what actually changed', () => {
  const plan = (reason: DecisionReason, stageTargetF: number, detail: string | null = null): TemperaturePlan => ({ stage: 'cooling', stageTargetF, desiredF: 66, reason, detail })
  assert.deepEqual(describeDecision(plan('room', 69, 'Room warm at 23.0 °C'), 70), { reason: 'schedule', detail: 'Room warm at 23.0 °C' })
  assert.deepEqual(describeDecision(plan('room', 69, 'Room warm at 23.0 °C'), 69), { reason: 'room', detail: 'Room warm at 23.0 °C' })
  assert.deepEqual(describeDecision(plan('schedule', 69), 69), { reason: 'room', detail: 'Room back to normal' })
  assert.deepEqual(describeDecision(plan('schedule', 69), 70), { reason: 'schedule', detail: null })
  assert.deepEqual(describeDecision(plan('wake', 72, 'Wake warm-up'), 72), { reason: 'wake', detail: 'Wake warm-up' })
})

test('the body clock needs enough sessions and handles midnight', () => {
  assert.equal(estimateTemperatureMinimumHour([3, 4, 5]), null)
  assert.ok(Math.abs((estimateTemperatureMinimumHour([3, 3, 3, 3]) ?? 0) - 4.2) < 1e-9)
  // Mid-sleep around midnight must not average to noon
  assert.ok(Math.abs((estimateTemperatureMinimumHour([23, 1, 23, 1]) ?? 0) - 1.2) < 1e-9)
})

test('early cooling is limited when the body clock is unknown or REM is likely', () => {
  assert.equal(coolDepthForSession(3, 8.5, null), CAUTIOUS_COOL_F)
  // Minimum at 06:00: the REM window (08:00-12:00) overlaps a morning session
  assert.equal(coolDepthForSession(3, 8.5, 6), CAUTIOUS_COOL_F)
  // Minimum at 05:00: a 22:00 session is clear of the window
  assert.equal(coolDepthForSession(3, 22, 5), 3)
  // Already shallower than the limit
  assert.equal(coolDepthForSession(1, 8.5, null), 1)
})

beforeEach(() => resetPresence())

test('absence starts when presence is lost', () => {
  assert.equal(getAbsentSince('left', START), null)
  recordPresence('left', true, START)
  recordPresence('left', false, START + minutes(10))
  assert.equal(getAbsentSince('left', START + minutes(30)), START + minutes(10))
})

test('short presence blips do not reset a running absence', () => {
  recordPresence('left', true, START)
  recordPresence('left', false, START + minutes(10))
  recordPresence('left', true, START + minutes(20))
  assert.equal(getAbsentSince('left', START + minutes(21)), START + minutes(10))
  recordPresence('left', false, START + minutes(21))
  assert.equal(getAbsentSince('left', START + minutes(70)), START + minutes(10))
})

test('real presence clears the absence and the next one starts fresh', () => {
  recordPresence('left', true, START)
  recordPresence('left', false, START + minutes(10))
  recordPresence('left', true, START + minutes(20))
  assert.equal(getAbsentSince('left', START + minutes(25)), null)
  recordPresence('left', false, START + minutes(40))
  assert.equal(getAbsentSince('left', START + minutes(41)), START + minutes(40))
  // The other side is tracked separately
  assert.equal(getAbsentSince('right', START + minutes(41)), null)
})

test('unknown presence never counts as absence', () => {
  recordPresence('left', true, START)
  recordPresence('left', false, START + minutes(10))
  recordPresence('left', null, START + minutes(20))
  assert.equal(getAbsentSince('left', START + minutes(120)), null)
})

test('an absence keeps its start time if presence stays lost after a dropout', () => {
  recordPresence('left', true, START)
  recordPresence('left', false, START + minutes(10))
  recordPresence('left', null, START + minutes(20))
  recordPresence('left', false, START + minutes(30))
  assert.equal(getAbsentSince('left', START + minutes(31)), START + minutes(10))
})
