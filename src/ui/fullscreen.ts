// Full-screen preference + Fullscreen API helpers. The preference is a per-browser convenience (never in WorldSave);
// entering full screen must happen inside a user gesture (click / key), so callers invoke enterFullscreen() from one.

const KEY = 'ibz.fullscreen.v1';

/** True when the browser can go full screen at all (false on e.g. iPhone Safari). */
export function fullscreenSupported(): boolean {
  return typeof document !== 'undefined' && !!document.documentElement.requestFullscreen && document.fullscreenEnabled !== false;
}

export function isFullscreen(): boolean {
  return typeof document !== 'undefined' && !!document.fullscreenElement;
}

export function loadFullscreenPref(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function saveFullscreenPref(on: boolean): void {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* storage blocked: preference just isn't remembered */ }
}

/** Request full screen (call from a user gesture). Never throws; resolves false if the browser refused. */
export async function enterFullscreen(): Promise<boolean> {
  if (!fullscreenSupported() || isFullscreen()) return isFullscreen();
  try {
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    return true;
  } catch {
    return false;
  }
}

export async function exitFullscreen(): Promise<void> {
  if (!isFullscreen()) return;
  try { await document.exitFullscreen(); } catch { /* already left */ }
}
