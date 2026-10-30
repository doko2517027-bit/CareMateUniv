import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");

test("学生登録は学籍番号から固定大学メールを作り、確認後にサーバー確定する", async () => {
  const [auth, html] = await Promise.all([read("auth.js"), read("index.html")]);
  assert.match(auth, /const email = sumsEmail\(number\)/);
  assert.match(auth, /completeStudyAppRegistration/);
  assert.match(auth, /email\.toLowerCase\(\) !== `\$\{number\}@sums\.ac\.jp`/);
  assert.doesNotMatch(html, /id="registerEmailLocal"/);
  assert.match(html, /認証メールを送信しました。大学メールをご確認ください/);
});

test("未完了登録は同じ本人のパスワードで安全に再開できる", async () => {
  const auth = await read("auth.js");
  assert.match(auth, /auth\/email-already-in-use/);
  assert.match(auth, /signInWithEmailAndPassword\(auth, email, password\)/);
  assert.match(auth, /if \(existing\)/);
});

test("パスワード再設定は学籍番号だけをサーバーへ送る", async () => {
  const auth = await read("auth.js");
  assert.match(auth, /requestStudyAppPasswordReset", \{ studentNumber: number \}/);
  assert.doesNotMatch(auth, /requestStudyAppPasswordReset", \{[^}]*email/);
});
