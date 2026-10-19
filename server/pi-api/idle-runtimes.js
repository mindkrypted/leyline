import { readBackendSettings, writeBackendSettings } from '../backend-connections.js'
import { DEFAULT_RUNTIME_IDLE_TIMEOUT_MINUTES, RUNTIME_IDLE_TIMEOUT_SETTING_KEY } from '../../lib/leyline-settings.js'
import { settingsError } from './pi-config.js'

export function getRuntimeSettings() {
  const value = readBackendSettings([RUNTIME_IDLE_TIMEOUT_SETTING_KEY])[RUNTIME_IDLE_TIMEOUT_SETTING_KEY]
  const minutes = value === '' ? DEFAULT_RUNTIME_IDLE_TIMEOUT_MINUTES : Number(value)
  return {
    idleTimeoutMinutes: Number.isInteger(minutes) && minutes >= 0 && minutes <= 1440
      ? minutes
      : DEFAULT_RUNTIME_IDLE_TIMEOUT_MINUTES,
  }
}

export function setRuntimeSettings(input) {
  if (!input || Object.keys(input).some(key => key !== 'idleTimeoutMinutes')
    || !Number.isInteger(input.idleTimeoutMinutes) || input.idleTimeoutMinutes < 0 || input.idleTimeoutMinutes > 1440) {
    throw settingsError('Idle timeout must be a whole number from 0 to 1440 minutes.')
  }
  writeBackendSettings({ [RUNTIME_IDLE_TIMEOUT_SETTING_KEY]: String(input.idleTimeoutMinutes) })
  return getRuntimeSettings()
}

export function createIdleRuntimeCleanup({ getHandles, isProtected, dispose }) {
  const lastUsed = new WeakMap()
  let timer

  function touch(handle) {
    if (handle) lastUsed.set(handle, Date.now())
  }

  function sweep() {
    try {
      const handles = [...getHandles()]
      if (!handles.length) return
      const { idleTimeoutMinutes } = getRuntimeSettings()
      const now = Date.now()
      for (const handle of handles) {
        if (!idleTimeoutMinutes || isProtected(handle) || !lastUsed.has(handle)) {
          touch(handle)
        } else if (now - lastUsed.get(handle) >= idleTimeoutMinutes * 60000) {
          dispose(handle).catch(error => console.error('Idle runtime cleanup failed', error))
        }
      }
    } catch (error) {
      console.error('Idle runtime cleanup failed', error)
    }
  }

  return {
    touch,
    start() {
      if (timer) return
      timer = setInterval(sweep, 15000)
      timer.unref?.()
    },
    stop() {
      clearInterval(timer)
      timer = undefined
    },
  }
}
