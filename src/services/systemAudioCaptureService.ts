const TARGET_SAMPLE_RATE = 24000
const CHUNK_DURATION_MS = 400

type AudioChunkListener = (audio: ArrayBuffer) => void

export class SystemAudioCaptureService {
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private silentOutput: GainNode | null = null
  private pendingSamples: Int16Array[] = []
  private pendingSampleCount = 0

  async start(onAudioChunk: AudioChunkListener): Promise<void> {
    if (this.stream) return

    let displayStream: MediaStream
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: true,
      })
    } catch (error) {
      throw new Error(this.getCaptureError(error))
    }

    displayStream.getVideoTracks().forEach((track) => track.stop())
    const audioTracks = displayStream.getAudioTracks()
    if (audioTracks.length === 0) {
      displayStream.getTracks().forEach((track) => track.stop())
      throw new Error('Windows system audio is unavailable for the current output device.')
    }

    this.stream = new MediaStream(audioTracks)
    this.context = new AudioContext()
    this.source = this.context.createMediaStreamSource(this.stream)
    this.processor = this.context.createScriptProcessor(4096, 1, 1)
    this.silentOutput = this.context.createGain()
    this.silentOutput.gain.value = 0

    this.processor.onaudioprocess = (event) => {
      const input = event.inputBuffer.getChannelData(0)
      const pcm = this.convertToPcm16(input, this.context?.sampleRate ?? 48000)
      this.pendingSamples.push(pcm)
      this.pendingSampleCount += pcm.length

      const targetSamples = (TARGET_SAMPLE_RATE * CHUNK_DURATION_MS) / 1000
      if (this.pendingSampleCount >= targetSamples) {
        onAudioChunk(this.flushSamples())
      }
    }

    this.source.connect(this.processor)
    this.processor.connect(this.silentOutput)
    this.silentOutput.connect(this.context.destination)
    await this.context.resume()

    if (import.meta.env.DEV) console.info('[AUDIO] system capture started')
  }

  async stop(): Promise<void> {
    const wasCapturing = this.stream !== null
    if (this.processor) {
      this.processor.onaudioprocess = null
      this.processor.disconnect()
    }
    this.source?.disconnect()
    this.silentOutput?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())
    if (this.context && this.context.state !== 'closed') await this.context.close()

    this.stream = null
    this.context = null
    this.source = null
    this.processor = null
    this.silentOutput = null
    this.pendingSamples = []
    this.pendingSampleCount = 0

    if (wasCapturing && import.meta.env.DEV) {
      console.info('[AUDIO] system capture stopped')
    }
  }

  private convertToPcm16(input: Float32Array, sourceRate: number): Int16Array {
    const ratio = sourceRate / TARGET_SAMPLE_RATE
    const output = new Int16Array(Math.round(input.length / ratio))
    for (let outputIndex = 0; outputIndex < output.length; outputIndex += 1) {
      const start = Math.floor(outputIndex * ratio)
      const end = Math.min(Math.floor((outputIndex + 1) * ratio), input.length)
      let sum = 0
      for (let inputIndex = start; inputIndex < end; inputIndex += 1) {
        sum += input[inputIndex]
      }
      const sample = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)))
      output[outputIndex] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
    }
    return output
  }

  private flushSamples(): ArrayBuffer {
    const output = new Int16Array(this.pendingSampleCount)
    let offset = 0
    for (const samples of this.pendingSamples) {
      output.set(samples, offset)
      offset += samples.length
    }
    this.pendingSamples = []
    this.pendingSampleCount = 0
    return output.buffer
  }

  private getCaptureError(error: unknown): string {
    if (error instanceof DOMException) {
      if (error.name === 'NotAllowedError') return 'System audio permission was denied.'
      if (error.name === 'NotFoundError') return 'Windows output device is unavailable.'
      if (error.name === 'NotSupportedError') {
        return 'System audio capture is unsupported by this Electron installation.'
      }
    }
    return 'System audio capture could not start.'
  }
}
