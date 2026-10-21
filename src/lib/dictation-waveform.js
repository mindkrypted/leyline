export const DICTATION_WAVE_BARS = 30

const interval = 1000 / 30
const baseline = 2

export function createDictationWaveform() {
  const history = []
  const heights = new Float32Array(DICTATION_WAVE_BARS).fill(baseline)

  function reset() {
    history.length = 0
    heights.fill(baseline)
  }

  function push(meter, now) {
    if (!Number.isFinite(now) || !Number.isFinite(meter?.rms) || !Number.isFinite(meter?.peak)) return
    const previous = history[history.length - 1]
    if (previous && (now <= previous.time || now - previous.time > 200)) reset()
    const rms = Math.max(0, Math.min(1, meter.rms))
    const peak = Math.max(rms, Math.min(1, meter.peak))
    history.push({ time: now, average: Math.sqrt(Math.min(1, rms * 9)), peak: Math.sqrt(Math.min(1, peak * 3)) })
    if (history.length > DICTATION_WAVE_BARS + 2) history.shift()
  }

  function height(sample, age) {
    const average = sample.average * Math.exp(-Math.LN2 * age / 80)
    const peak = sample.peak * Math.exp(-Math.LN2 * age / 122)
    return baseline + 16 * Math.max(average, peak)
  }

  function read(now) {
    if (!history.length || !Number.isFinite(now)) return heights.fill(baseline)
    const age = Math.max(0, now - history[history.length - 1].time - 2 * interval)
    let cursor = 0
    for (let index = 0; index < heights.length; index++) {
      const time = now - (heights.length - 1 - index) * interval
      if (time < history[0].time) {
        heights[index] = baseline
        continue
      }
      while (cursor + 1 < history.length && history[cursor + 1].time <= time) cursor++
      const left = history[cursor]
      const right = history[cursor + 1]
      const from = height(left, age)
      heights[index] = right
        ? from + (height(right, age) - from) * ((time - left.time) / (right.time - left.time))
        : from
    }
    return heights
  }

  return { push, read, reset }
}
