import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [store, admin, app, index, worker] = await Promise.all([
  readFile(new URL("./store.js", import.meta.url), "utf8"),
  readFile(new URL("./admin.js", import.meta.url), "utf8"),
  readFile(new URL("./app.js", import.meta.url), "utf8"),
  readFile(new URL("./index.html", import.meta.url), "utf8"),
  readFile(new URL("./sw.js", import.meta.url), "utf8"),
]);
const exam = await readFile(new URL("./exam.js", import.meta.url), "utf8");

test("管理画面はサーバーの最新データと保存済み下書きを読み直す", () => {
  assert.match(store, /getDocsFromServer/);
  assert.match(store, /export async function listUnitsWithDrafts/);
  assert.match(admin, /listCategories\(\{ forceServer: true \}\)/);
  assert.match(admin, /listSubjects\(\{ forceServer: true \}\)/);
  assert.match(admin, /listUnitsWithDrafts\(subject\.id\)/);
});

test("公開済みの問題変更は保存操作で学生側へ反映する", () => {
  assert.match(app, /const saveAction = unit\.published \? "publish" : "save"/);
  assert.match(app, /let submitAction = saveAction/);
  assert.match(app, /変更を保存して反映/);
  assert.match(admin, /if \(editable\.published\) \{\s*await publishUnitDraft/);
});

test("表示順の意味を小さな補足で案内する", () => {
  assert.match(admin, /<small>表示の順番の番号<\/small>/);
  assert.match(admin, /hint: "表示の順番の番号"/);
  assert.match(app, /field\.hint/);
  assert.match(app, /<small class="field-note">表示の順番の番号<\/small>/);
});

test("学生管理一覧はメールアドレスを表示しない", () => {
  assert.match(admin, /: "学生";/);
  assert.doesNotMatch(admin, /学生\$\{user\.email/);
});

test("各問題の出典・ソースは必須で保存し学生側へ表示する", () => {
  assert.match(app, /出典・ソース（必須）/);
  assert.match(app, /data-role="source"/);
  assert.match(app, /data-role="source"[^>]*required/);
  assert.match(app, /source: card\.querySelector\('\[data-role="source"\]'\)\.value\.trim\(\)/);
  assert.match(app, /出典・ソースを入力してください/);
  assert.match(store, /source: safeText\(item\.source, 1000\)/);
  assert.match(store, /requireSources/);
  assert.match(exam, /<strong>出典・ソース<\/strong>/);
  assert.match(exam, /<span class="test-content-label">出典・ソース<\/span>/);
});

test("更新した資産番号がHTMLとService Workerで一致する", () => {
  assert.match(index, /styles\.css\?v=18/);
  assert.match(index, /app\.js\?v=21/);
  assert.match(worker, /caremate-univ-v21/);
  assert.match(worker, /store\.js\?v=17/);
  assert.match(worker, /exam\.js\?v=15/);
  assert.match(worker, /admin\.js\?v=16/);
});
