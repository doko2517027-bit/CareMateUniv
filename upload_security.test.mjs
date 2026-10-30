import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL(name, import.meta.url), "utf8");

test("Cloudinary API Secretと無署名プリセットをブラウザへ置かない", async () => {
  const [upload, app, notices] = await Promise.all([read("upload.js"), read("app.js"), read("notices.js")]);
  assert.doesNotMatch(`${upload}\n${app}\n${notices}`, /upload_preset|caremate_upload|CLOUDINARY_API_SECRET/);
  assert.match(upload, /createStudyAppUploadSignature/);
  assert.match(upload, /authorization\.signature/);
});

test("画像・PDFの形式と容量をブラウザでも制限する", async () => {
  const upload = await read("upload.js");
  assert.match(upload, /image\/jpeg/);
  assert.match(upload, /image\/png/);
  assert.match(upload, /image\/webp/);
  assert.match(upload, /application\/pdf/);
  assert.match(upload, /isPdf \? 20 : 10\) \* 1024 \* 1024/);
});
