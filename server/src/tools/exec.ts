/**
 * 📘 LESSON: Running other programs safely
 * Node can start other programs with child_process. Two very different ways:
 *
 *   ❌ exec("start " + userInput)         → runs through a SHELL. If userInput is
 *                                           "chrome & del C:\\important", BOTH run. 💥
 *   ✅ execFile("program", ["arg1"])       → NO shell. Arguments are passed as data,
 *                                           so "&", ";", "|" are just characters.
 *
 * We ALWAYS use execFile, with a timeout, and only with values from our own allowlists.
 */
import { execFile } from "node:child_process";

export function runProgram(file: string, args: string[], timeoutMs = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim() || err.message));
      else resolve(stdout.trim());
    });
  });
}

/** Runs a FIXED PowerShell script (never build it from AI/user text). */
export function runPowerShell(script: string): Promise<string> {
  return runProgram("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
}

/** Opens an http(s) URL in the default browser, without any shell. */
export function openUrl(url: string): Promise<string> {
  return runProgram("rundll32.exe", ["url.dll,FileProtocolHandler", url]);
}
