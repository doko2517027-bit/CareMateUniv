import test from "node:test";
import assert from "node:assert/strict";
import {
  SESSION_ABSOLUTE_MS,
  SESSION_IDLE_MS,
  SESSION_WARNING_MS,
  evaluateSession,
} from "./session.js";

test("操作が30分ない場合はセッション切れになる", () => {
  const now = 1_000_000_000;
  const result = evaluateSession({ startedAt: now - 60_000, lastActivityAt: now - SESSION_IDLE_MS }, now);
  assert.equal(result.expired, true);
  assert.equal(result.reason, "idle");
});

test("操作中でもログインから12時間でセッション切れになる", () => {
  const now = 1_000_000_000;
  const result = evaluateSession({ startedAt: now - SESSION_ABSOLUTE_MS, lastActivityAt: now - 10_000 }, now);
  assert.equal(result.expired, true);
  assert.equal(result.reason, "absolute");
});

test("期限前の操作中セッションは有効で警告時間も定義される", () => {
  const now = 1_000_000_000;
  const result = evaluateSession({ startedAt: now - 60_000, lastActivityAt: now - 60_000 }, now);
  assert.equal(result.valid, true);
  assert.equal(result.expired, false);
  assert.equal(SESSION_WARNING_MS, 2 * 60 * 1000);
});
