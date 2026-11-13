/**
 * Speaks reminders out loud, one after another, and copes with Chrome's AUTOPLAY rule.
 *
 * 📘 Autoplay rule: a page may only play sound after you have clicked / pressed a key on it
 * at least once. A reminder that rings right after you opened or refreshed the tab would be
 * silently blocked. So when play() is refused, we keep the text and try again on your first
 * click or key press, and tell the UI ("blocked") so it can show a hint.
 */
import * as api from "../api";

const queue: string[] = [];
let playing = false;
let blocked = false;
const listeners = new Set<(blocked: boolean) => void>();

function setBlocked(value: boolean) {
  if (blocked === value) return;
  blocked = value;
  listeners.forEach((fn) => fn(value));
}

/** The UI subscribes to show "🔊 Click anywhere to hear your reminders". Returns an unsubscribe function. */
export function onBlockedChange(fn: (blocked: boolean) => void): () => void {
  listeners.add(fn);
  fn(blocked);
  return () => listeners.delete(fn);
}

export function announce(text: string) {
  queue.push(text);
  void playNext();
}

async function playNext() {
  if (playing || queue.length === 0) return;
  playing = true;
  const text = queue[0];
  try {
    const url = URL.createObjectURL(await api.speak(text));
    try {
      const audio = new Audio(url);
      await audio.play(); // ← throws NotAllowedError when Chrome blocks autoplay
      queue.shift();
      setBlocked(false);
      await new Promise<void>((done) => {
        audio.onended = audio.onerror = () => done();
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "NotAllowedError") {
      setBlocked(true); // keep it in the queue → retried on the first click/key press
      playing = false;
      return;
    }
    queue.shift(); // voice engine failed → skip this one (banner + Windows pop-up still show)
  }
  playing = false;
  void playNext();
}

// Any click or key press "unlocks" audio → play what was waiting
const unlock = () => {
  if (blocked) void playNext();
};
window.addEventListener("pointerdown", unlock);
window.addEventListener("keydown", unlock);
