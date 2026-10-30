import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");

test("問題編集は公開状態に応じて保存・公開操作を分かりやすく切り替える", async () => {
  const app = await read("app.js");
  assert.match(app, /const saveLabel = unit\.published \? "変更を保存して反映" : "編集内容を保存"/);
  assert.match(app, /const publishButton = unit\.published \? "" : `<button id="publishQuestions"/);
  assert.match(app, /id="saveEditedQuestions"/);
  assert.doesNotMatch(app, /name="published" type="checkbox"/);
});

test("編集保存と学生公開は別処理で管理する", async () => {
  const store = await read("store.js");
  const admin = await read("admin.js");
  assert.match(store, /export async function saveUnitDraft/);
  assert.match(store, /export async function publishUnitDraft/);
  assert.match(store, /"drafts", "edited"/);
  assert.doesNotMatch(store, /draft:\s*published/);
  assert.match(admin, /action === "publish"/);
  assert.match(admin, /await saveUnitDraft/);
  assert.match(admin, /await publishUnitDraft/);
});

test("科目・単元の作成画面に公開チェックを重複表示しない", async () => {
  const admin = await read("admin.js");
  assert.doesNotMatch(admin, /name="published" type="checkbox"/);
  assert.match(admin, /公開は問題編集画面で行います/);
});
