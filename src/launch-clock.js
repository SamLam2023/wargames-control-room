export const LAUNCH_WINDOW_MS = 180000;

export function launchProgress(deadline, now = Date.now()) {
  const remainingMs = deadline == null ? LAUNCH_WINDOW_MS : Math.max(0, Math.min(LAUNCH_WINDOW_MS, deadline - now));
  const elapsed = LAUNCH_WINDOW_MS - remainingMs;
  return { remainingMs, locked: Math.min(10, Math.floor(elapsed / (LAUNCH_WINDOW_MS / 10))),
    defcon: Math.max(1, 4 - Math.floor(elapsed / (LAUNCH_WINDOW_MS / 4))) };
}

export function formatCountdown(milliseconds) {
  const seconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
