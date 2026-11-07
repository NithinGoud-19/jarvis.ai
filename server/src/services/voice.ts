/**
 * Voice service: speech → text (whisper.cpp) and text → speech (Piper).
 * Both are separate programs. We run them with execFile/spawn (no shell!) and pass
 * audio through temporary files.
 *
 * 📘 LESSON: Temporary files
 * Two requests can arrive at the same time, so each one gets a UNIQUE file name
 * (randomUUID). We ALWAYS delete the files in `finally`, even if something fails.
 */
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "../config.js";

export function voiceStatus() {
  const files = {
    whisper: config.whisperBin,
    whisperModel: config.whisperModel,
    piper: config.piperBin,
    piperModel: config.piperModel,
  };
  const missing = Object.entries(files)
    .filter(([, p]) => !existsSync(p))
    .map(([name]) => name);
  return { speechToText: !missing.some((m) => m.startsWith("whisper")), textToSpeech: !missing.some((m) => m.startsWith("piper")), missing };
}

const tempFile = (ext: string) => path.join(os.tmpdir(), `jarvis-${randomUUID()}.${ext}`);

/**
 * Measures how loud a 16-bit WAV recording is. 0 = total silence, 1 = maximum.
 * 📘 Each sample is a number from -32768 to 32767. "Peak" = the loudest one.
 */
export function measureVolume(wav: Buffer): { peak: number; rms: number } {
  const dataIndex = wav.indexOf("data");
  const start = dataIndex >= 0 ? dataIndex + 8 : 44;
  let peak = 0;
  let sumSquares = 0;
  let count = 0;
  for (let i = start; i + 1 < wav.length; i += 2) {
    const s = Math.abs(wav.readInt16LE(i)) / 32768;
    if (s > peak) peak = s;
    sumSquares += s * s;
    count++;
  }
  return { peak, rms: count ? Math.sqrt(sumSquares / count) : 0 };
}

/** WAV audio (any sample rate) → text. */
export async function transcribe(wav: Buffer): Promise<string> {
  const file = tempFile("wav");
  try {
    await fs.writeFile(file, wav);
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        config.whisperBin,
        // -nt: no timestamps · -np: print only the result · -t: CPU threads · -l: language
        ["-m", config.whisperModel, "-f", file, "-nt", "-np", "-t", "6", "-l", "en"],
        { timeout: 60_000, windowsHide: true },
        (err, out, errOut) => (err ? reject(new Error(errOut.trim() || err.message)) : resolve(out)),
      );
    });
    // Whisper writes things like "[BLANK_AUDIO]" or "(music)" when there is no speech
    return stdout
      .replace(/\[[^\]]*\]|\([^)]*\)/g, "")
      .replace(/\s+/g, " ")
      .trim();
  } finally {
    await fs.rm(file, { force: true });
  }
}

/** Remove things that sound bad when read aloud (emojis, markdown symbols, links). */
function cleanForSpeech(text: string): string {
  return text
    .replace(/https?:\/\/\S+/g, "the link")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[*_#`>~|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Text → WAV audio (British voice). */
export async function speak(text: string): Promise<Buffer> {
  const clean = cleanForSpeech(text);
  if (!clean) throw new Error("Nothing to say");

  const file = tempFile("wav");
  try {
    await new Promise<void>((resolve, reject) => {
      const piper = spawn(config.piperBin, ["--model", config.piperModel, "--output_file", file], {
        windowsHide: true,
      });
      const timer = setTimeout(() => piper.kill(), 60_000);
      let errOut = "";
      piper.stderr.on("data", (d) => (errOut += d));
      piper.on("error", reject);
      piper.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`Piper failed (${code}): ${errOut.slice(-300)}`));
      });
      // 📘 stdin: Piper reads the text from its "standard input", like typing into it
      piper.stdin.end(clean);
    });
    return await fs.readFile(file);
  } finally {
    await fs.rm(file, { force: true });
  }
}
