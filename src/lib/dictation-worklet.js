class DictationProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.ratio = sampleRate / 16000
    this.weight = 0
    this.sum = 0
    this.chunk = new Float32Array(1600)
    this.offset = 0
    this.samples = 0
    this.meterSamples = 0
    this.meterSum = 0
    this.meterPeak = 0
    this.limit = options.processorOptions.maxSeconds * 16000
    this.stopped = false
    this.port.onmessage = ({ data }) => {
      if (data === 'flush') {
        this.stopped = true
        this.flush()
        this.port.postMessage({ type: 'flushed' })
      }
    }
  }

  flush() {
    if (!this.offset) return
    const pcm = this.chunk.slice(0, this.offset)
    this.port.postMessage({ type: 'audio', pcm }, [pcm.buffer])
    this.offset = 0
  }

  measure(sample) {
    const value = Number.isFinite(sample) ? Math.max(-1, Math.min(1, sample)) : NaN
    this.meterSum += value * value
    this.meterPeak = Math.max(this.meterPeak, Math.abs(value))
    if (++this.meterSamples < 533) return
    if (Number.isFinite(this.meterSum) && Number.isFinite(this.meterPeak)) {
      this.port.postMessage({ type: 'meter', rms: Math.sqrt(this.meterSum / this.meterSamples), peak: this.meterPeak })
    }
    this.meterSamples = 0
    this.meterSum = 0
    this.meterPeak = 0
  }

  process(inputs) {
    if (this.stopped) return true
    const channels = inputs[0]
    if (!channels?.length) return true
    for (let frame = 0; frame < channels[0].length; frame++) {
      let mono = 0
      for (const channel of channels) mono += channel[frame]
      mono /= channels.length
      let remaining = 1
      while (remaining > 1e-8) {
        const weight = Math.min(remaining, this.ratio - this.weight)
        this.sum += mono * weight
        this.weight += weight
        remaining -= weight
        if (this.weight + 1e-8 < this.ratio) continue
        this.chunk[this.offset++] = this.sum / this.ratio
        this.measure(this.chunk[this.offset - 1])
        this.samples++
        this.weight = 0
        this.sum = 0
        if (this.offset === this.chunk.length) this.flush()
        if (this.samples >= this.limit) {
          this.stopped = true
          this.flush()
          this.port.postMessage({ type: 'limit' })
          return true
        }
      }
    }
    return true
  }
}

registerProcessor('leyline-dictation', DictationProcessor)
