const TARGET_SAMPLE_RATE = 24000
const CHUNK_DURATION_MS = 400

type AudioChunkListener = (audio: ArrayBuffer) => void

export class AudioCaptureService {
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private processor: ScriptProcessorNode | null = null
  private silentOutput: GainNode | null = null
  private pendingSamples: Int16Array[] = []
  private pendingSampleCount = 0

  async start(onAudioChunk: AudioChunkListener): Promise<void> {
    if (this.stream) return

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
    } catch (error) {
      throw new Error(this.getMicrophoneError(error))
    }

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
  }

  async stop(): Promise<void> {
    if (this.processor) {
      this.processor.onaudioprocess = null
      this.processor.disconnect()
    }
    this.source?.disconnect()
    this.silentOutput?.disconnect()
    this.stream?.getTracks().forEach((track) => track.stop())

    if (this.context && this.context.state !== 'closed') {
      await this.context.close()
    }

    this.stream = null
    this.context = null
    this.source = null
    this.processor = null
    this.silentOutput = null
    this.pendingSamples = []
    this.pendingSampleCount = 0
  }

  private convertToPcm16(input: Float32Array, sourceRate: number): Int16Array {
    const ratio = sourceRate / TARGET_SAMPLE_RATE
    const outputLength = Math.round(input.length / ratio)
    const output = new Int16Array(outputLength)

    for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
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

  private getMicrophoneError(error: unknown): string {
    if (error instanceof DOMException) {
      if (error.name === 'NotAllowedError') {
        return 'Microphone permission was denied. Allow access in Windows settings and try again.'
      }
      if (error.name === 'NotFoundError') return 'No microphone is available.'
      if (error.name === 'NotReadableError') {
        return 'The microphone is unavailable or already in use.'
      }
    }
    return 'The microphone could not be started.'
  }
}
