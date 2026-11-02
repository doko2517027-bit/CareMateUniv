export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 12 * 60 * 60 * 1000;
export const SESSION_WARNING_MS = 2 * 60 * 1000;

const KEYS = Object.freeze({
  uid: "cmuSessionUid",
  startedAt: "cmuSessionStartedAt",
  lastActivityAt: "cmuSessionLastActivityAt",
});

function validTime(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function evaluateSession(session, now = Date.now()) {
  const startedAt = validTime(session?.startedAt);
  const lastActivityAt = validTime(session?.lastActivityAt);
  if (!startedAt || !lastActivityAt) return { valid: false, expired: false, reason: "missing", remainingMs: 0 };
  const idleRemainingMs = SESSION_IDLE_MS - Math.max(0, now - lastActivityAt);
  const absoluteRemainingMs = SESSION_ABSOLUTE_MS - Math.max(0, now - startedAt);
  const remainingMs = Math.min(idleRemainingMs, absoluteRemainingMs);
  const reason = absoluteRemainingMs <= idleRemainingMs ? "absolute" : "idle";
  return { valid: true, expired: remainingMs <= 0, reason, remainingMs, idleRemainingMs, absoluteRemainingMs };
}

export function readStoredSession(uid) {
  if (!uid || localStorage.getItem(KEYS.uid) !== uid) return null;
  const session = {
    uid,
    startedAt: validTime(localStorage.getItem(KEYS.startedAt)),
    lastActivityAt: validTime(localStorage.getItem(KEYS.lastActivityAt)),
  };
  return session.startedAt && session.lastActivityAt ? session : null;
}

export function createStoredSession(uid, now = Date.now()) {
  if (!uid) return null;
  localStorage.setItem(KEYS.uid, uid);
  localStorage.setItem(KEYS.startedAt, String(now));
  localStorage.setItem(KEYS.lastActivityAt, String(now));
  return { uid, startedAt: now, lastActivityAt: now };
}

export function ensureStoredSession(uid, now = Date.now()) {
  return readStoredSession(uid) || createStoredSession(uid, now);
}

export function touchStoredSession(uid, now = Date.now()) {
  const current = readStoredSession(uid);
  if (!current) return null;
  localStorage.setItem(KEYS.lastActivityAt, String(now));
  return { ...current, lastActivityAt: now };
}

export function clearStoredSession() {
  Object.values(KEYS).forEach((key) => localStorage.removeItem(key));
}

