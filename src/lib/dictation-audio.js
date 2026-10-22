export function createDictationAudio({ deviceId, maxSeconds, onAudio, onLevel, onLimit, onError }) {
  let stopped = false
  let stream
  let context
  let source
  let node
  let sink
  let closePromise
  let releasePromise
  let flushDone
  let cancelDone
  const cancelled = new Promise(resolve => { cancelDone = resolve })

  function stopTracks() {
    stream?.getTracks().forEach(track => {
      track.onended = null
      track.stop()
    })
  }

  function release() {
    if (releasePromise) return releasePromise
    stopTracks()
    try { source?.disconnect() } catch {}
    try { node?.disconnect() } catch {}
    try { sink?.disconnect() } catch {}
    if (node) {
      node.port.onmessage = null
      node.onprocessorerror = null
    }
    releasePromise = context && context.state !== 'closed' ? context.close() : Promise.resolve()
    return releasePromise
  }

  function cancel() {
    stopped = true
    cancelDone(false)
    flushDone?.()
    return Promise.all([release(), preparing.catch(() => {})]).then(() => {})
  }

  const preparing = (async () => {
    if (window.isSecureContext === false) throw new Error('Microphone access requires HTTPS or localhost. Open Leyline over HTTPS to use dictation.')
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone capture is unavailable')
    stream = await navigator.mediaDevices.getUserMedia({
      video: false,
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        channelCount: 1,
        sampleRate: 16000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    if (stopped) {
      stopTracks()
      return false
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext
    try {
      context = new AudioContext({ sampleRate: 16000 })
    } catch {
      context = new AudioContext()
    }
    const { default: workletUrl } = await import('./dictation-worklet.js?url')
    if (stopped) return false
    await context.audioWorklet.addModule(workletUrl)
    if (stopped) return false
    node = new AudioWorkletNode(context, 'leyline-dictation', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      processorOptions: { maxSeconds },
    })
    node.port.onmessage = ({ data }) => {
      if (data.type === 'flushed') {
        flushDone?.()
        return
      }
      if (stopped) return
      if (data.type === 'limit') {
        onLimit()
        return
      }
      if (data.type === 'meter') {
        if (!Number.isFinite(data.rms) || !Number.isFinite(data.peak)) return
        const rms = Math.max(0, Math.min(1, data.rms))
        const peak = Math.max(rms, Math.min(1, data.peak))
        onLevel?.(Math.min(1, rms * 4), { rms, peak })
        return
      }
      if (data.type !== 'audio') return
      const pcm = data.pcm
      for (let index = 0; index < pcm.length; index++) {
        if (!Number.isFinite(pcm[index])) {
          onError(new Error('Invalid dictation audio sample'))
          return
        }
        pcm[index] = Math.max(-1, Math.min(1, pcm[index]))
      }
      onAudio?.(pcm)
    }
    node.onprocessorerror = () => { if (!stopped) onError(new Error('Microphone audio processing stopped')) }
    for (const track of stream.getAudioTracks()) {
      track.onended = () => { if (!stopped) onError(new Error('Microphone disconnected')) }
    }
    source = context.createMediaStreamSource(stream)
    sink = context.createGain()
    sink.gain.value = 0
    source.connect(node)
    node.connect(sink)
    sink.connect(context.destination)
    await context.resume()
    return !stopped
  })().catch(error => {
    stopped = true
    flushDone?.()
    void release().catch(() => {})
    throw error
  })
  const ready = Promise.race([preparing, cancelled])

  function close() {
    if (closePromise) return closePromise
    stopTracks()
    closePromise = (async () => {
      if (!await ready || stopped) return
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Microphone audio did not drain')), 1500)
        flushDone = () => { clearTimeout(timeout); resolve() }
        node.port.postMessage('flush')
      })
      stopped = true
      await release()
    })().catch(async error => {
      await cancel()
      throw error
    })
    return closePromise
  }

  return { ready, close, cancel }
}
