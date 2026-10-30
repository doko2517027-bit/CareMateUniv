import test from "node:test";
import assert from "node:assert/strict";
import { createStudySession, restoreStudySession, stableQuestionKey } from "./shuffle.js";

const questions = [
  { id: "fill-a", type: "fill_blank", sourceIndex: 0, question: "穴埋め" },
  { id: "quiz-a", type: "quiz", sourceIndex: 0, question: "単一", choices: ["A", "B", "C"], answers: [1], answer: 1 },
  { id: "quiz-b", type: "quiz", sourceIndex: 1, question: "複数", choices: ["W", "X", "Y", "Z"], answers: [0, 2], answer: 0 },
];

test("新規開始は問題順と選択肢順を保存する", () => {
  const randomValues = [0, 0, 0, 0, 0, 0, 0];
  const session = createStudySession(questions, () => randomValues.shift() ?? 0);
  assert.equal(session.order.length, 3);
  assert.notDeepEqual(session.order, questions.map(stableQuestionKey));
  assert.deepEqual(Object.keys(session.choiceOrders).sort(), ["quiz:id:quiz-a", "quiz:id:quiz-b"]);
});

test("再開では同じ問題順と選択肢順を復元し正解番号を変換する", () => {
  const session = {
    version: 1,
    active: true,
    position: 1,
    order: ["quiz:id:quiz-b", "fill_blank:id:fill-a", "quiz:id:quiz-a"],
    choiceOrders: {
      "quiz:id:quiz-b": [2, 0, 3, 1],
      "quiz:id:quiz-a": [2, 0, 1],
    },
    results: { "quiz:id:quiz-b": true },
  };
  const restored = restoreStudySession(questions, session);
  assert.deepEqual(restored.session.order, session.order);
  assert.equal(restored.session.position, 1);
  assert.deepEqual(restored.items[0].choices, ["Y", "W", "Z", "X"]);
  assert.deepEqual(restored.items[0].answers, [0, 1]);
  assert.deepEqual(restored.items[2].choices, ["C", "A", "B"]);
  assert.deepEqual(restored.items[2].answers, [2]);
  assert.deepEqual(restored.session.results, { "quiz:id:quiz-b": true });
});

test("途中で削除された問題を除外し、追加問題は保存順の末尾へ加える", () => {
  const session = createStudySession(questions, () => 0);
  const changed = [questions[2], { id: "fill-new", type: "fill_blank", sourceIndex: 1, question: "追加" }];
  const restored = restoreStudySession(changed, session);
  assert.equal(restored.items.some((item) => item.id === "quiz-a"), false);
  assert.equal(restored.items.at(-1).id, "fill-new");
  assert.equal(restored.session.order.length, 2);
});

test("旧学習を移行する非シャッフルセッションは登録順を維持する", () => {
  const session = createStudySession(questions, Math.random, { shuffled: false });
  assert.deepEqual(session.order, questions.map(stableQuestionKey));
  assert.deepEqual(session.choiceOrders["quiz:id:quiz-a"], [0, 1, 2]);
});
