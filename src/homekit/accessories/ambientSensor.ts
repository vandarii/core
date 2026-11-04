/**
 * HomeKit TemperatureSensor accessory for the room: the external sensor while
 * it is fresh, else the Pod's own air sensor (see getDeviceEnrichment). Exposed
 * as a generic temperature sensor so Home / automations can react to room
 * conditions the same way they would to any third-party thermometer.
 *
 * Poll cadence matches the Pod's 60s write rate; a faster poll would just
 * return the same value.
 */

import { Service, Characteristic } from 'hap-nodejs'
import { getDeviceEnrichment } from '@/src/hardware/deviceEnrichment'

const POLL_MS = 60_000

// Returned by onGet before the first DB read lands. HomeKit requires a
// numeric value; 20°C is a benign room-temperature sentinel that won't
// look like a sensor fault in the Home app.
const NEUTRAL_C = 20

export interface AmbientSensorAccessory {
  service: Service
  stop: () => void
}

export function buildAmbientSensor(): AmbientSensorAccessory {
  const service = new Service.TemperatureSensor('Pod ambient', 'ambient')
  let lastC: number = NEUTRAL_C

  service.getCharacteristic(Characteristic.CurrentTemperature)
    .onGet(() => lastC)

  const refresh = async (): Promise<void> => {
    const c = (await getDeviceEnrichment()).roomClimate.temperatureC
    if (c == null) return
    lastC = c
    service.updateCharacteristic(Characteristic.CurrentTemperature, c)
  }
  void refresh()
  const handle = setInterval(() => void refresh(), POLL_MS)
  handle.unref()

  return {
    service,
    stop: () => clearInterval(handle),
  }
}
