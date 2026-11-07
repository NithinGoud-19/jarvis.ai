/**
 * Microphone recorder that produces a 16 kHz mono WAV file (the format Whisper likes).
 * Browsers normally record WebM/Opus, which whisper.cpp can't read, so we capture the
 * raw audio samples ourselves and build the WAV file by hand. No ffmpeg needed.
 */
const TARGET_RATE = 16_000;

export class Recorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  /** 0..1 loudness of the latest chunk — used to animate the UI */
  level = 0;
  /** Name of the microphone Chrome is using, e.g. "Microphone Array (Realtek(R) Audio)" */
  micName = "";

  async start(): Promise<void> {
    // Create the audio engine FIRST, while we are still inside the click.
    // Browsers keep audio "suspended" if it starts after waiting — that records silence.
    this.ctx = new AudioContext();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (this.ctx.state === "suspended") await this.ctx.resume();
    this.micName = this.stream.getAudioTracks()[0]?.label ?? "";
    const source = this.ctx.createMediaStreamSource(this.stream);
    // ScriptProcessorNode is old but simple and works in every browser.
    this.node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    this.node.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      this.chunks.push(new Float32Array(data));
      let sum = 0;
      for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
      this.level = Math.min(1, Math.sqrt(sum / data.length) * 8);
    };
    source.connect(this.node);
    this.node.connect(this.ctx.destination);
  }

  /** Stops recording and returns the WAV file, plus its length in seconds. */
  async stop(): Promise<{ wav: Blob; seconds: number }> {
    const rate = this.ctx?.sampleRate ?? 48_000;
    this.node?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close();
    this.ctx = null;
    this.level = 0;

    const samples = downsample(merge(this.chunks), rate, TARGET_RATE);
    this.chunks = [];
    return { wav: encodeWav(samples, TARGET_RATE), seconds: samples.length / TARGET_RATE };
  }
}

function merge(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** 48000 samples/sec → 16000 samples/sec by averaging neighbours. */
export function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.floor((i + 1) * ratio), input.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

/** Builds a WAV file: a 44-byte header followed by 16-bit audio samples. */
export function encodeWav(samples: Float32Array, rate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const text = (offset: number, s: string) =>
    [...s].forEach((ch, i) => v.setUint8(offset + i, ch.charCodeAt(0)));

  text(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true); // bytes per second
  v.setUint16(32, 2, true); // bytes per sample
  v.setUint16(34, 16, true); // bits per sample
  text(36, "data");
  v.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: "audio/wav" });
}
