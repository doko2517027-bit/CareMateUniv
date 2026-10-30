import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = async (file) => readFile(new URL(file, import.meta.url), "utf8");

test("試験対策の進捗はCSPで遮断されるインラインCSSに依存しない", async () => {
  const [exam, admin] = await Promise.all([source("./exam.js"), source("./admin.js")]);
  assert.match(exam, /<progress class="progress-meter/);
  assert.match(exam, /stroke-dasharray="\$\{safe\} \$\{100 - safe\}"/);
  assert.doesNotMatch(exam, /style="(?:--progress|width:)/);
  assert.doesNotMatch(admin, /style="(?:--progress|width:)/);
});

test("棒線と円形の色部分を値属性とSVGで描画する", async () => {
  const css = await source("./styles.css");
  assert.match(css, /progress-meter::\-webkit-progress-value/);
  assert.match(css, /progress-ring-value\{stroke:var\(--primary\)/);
});
