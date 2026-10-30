import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");

test("公開フロントには秘密鍵を置かず、別サイトのフレーム埋め込みを拒否する", async () => {
  const [html, security, auth] = await Promise.all([read("index.html"), read("security.js"), read("auth.js")]);
  assert.match(html, /security\.js/);
  assert.match(security, /window\.top === window\.self/);
  assert.match(security, /replaceChildren/);
  assert.doesNotMatch(`${html}\n${security}\n${auth}`, /BEGIN PRIVATE KEY|CLOUDINARY_API_SECRET/);
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /style=/);
});
