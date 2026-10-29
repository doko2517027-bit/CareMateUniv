import { auth } from "./firebase.js";
import { getProgress, listCategories, listSubjects, listUnits, reportQuestion, saveProgress } from "./store.js";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function percent(progress = {}) {
  const answered = Number(progress.answered || 0);
  const total = Number(progress.total || 0);
  return total > 0 ? Math.min(100, Math.round((answered / total) * 100)) : 0;
}

export async function renderTestHome(root, context) {
  root.innerHTML = `<section class="hero"><div><span class="chip">テスト対策</span><h2>学びたい科目を選択</h2><p>管理者が公開した問題だけが表示されます。</p></div><span class="hero-badge">${escapeHtml(context.profile.name)}</span></section><section class="panel"><div class="panel-header"><div><h2>科目</h2><p>単元ごとに要点確認・問題演習・問題一覧を利用できます。</p></div></div><div id="subjectGrid" class="grid"><p class="empty">読み込み中…</p></div></section>`;
  const [categories, subjects] = await Promise.all([listCategories(), listSubjects({ publishedOnly: true })]);
  const categoryMap = new Map(categories.map((item) => [item.id, item.name]));
  const grid = root.querySelector("#subjectGrid");
  if (!subjects.length) {
    grid.innerHTML = `<div class="empty"><strong>公開中の問題はまだありません</strong><p>管理者が問題を公開すると、ここに表示されます。</p></div>`;
    return;
  }
  grid.innerHTML = subjects.map((subject) => `<article class="card"><span class="chip">${escapeHtml(categoryMap.get(subject.categoryId) || "テスト")}</span><h3>${escapeHtml(subject.name)}</h3><p>単元と問題を確認して学習を始めます。</p><button class="primary-button" data-subject="${escapeHtml(subject.id)}" type="button">単元を見る</button></article>`).join("");
  grid.querySelectorAll("[data-subject]").forEach((button) => button.addEventListener("click", () => renderSubject(root, context, subjects.find((item) => item.id === button.dataset.subject))));
}

async function renderSubject(root, context, subject) {
  root.innerHTML = `<div class="study-header"><button class="back-button" type="button" aria-label="戻る">‹</button><div><span class="brand-mini">SUBJECT</span><h2>${escapeHtml(subject.name)}</h2></div></div><section class="panel"><div class="panel-header"><div><h2>単元</h2><p>学習内容を選択してください。</p></div></div><div id="unitGrid" class="grid"><p class="empty">読み込み中…</p></div></section>`;
  root.querySelector(".back-button").addEventListener("click", () => renderTestHome(root, context));
  const units = await listUnits(subject.id, { publishedOnly: true });
  const progressItems = await Promise.all(units.map((unit) => getProgress(auth.currentUser.uid, subject.id, unit.id)));
  const grid = root.querySelector("#unitGrid");
  if (!units.length) { grid.innerHTML = `<div class="empty">公開中の単元はまだありません。</div>`; return; }
  grid.innerHTML = units.map((unit, index) => {
    const value = percent(progressItems[index]);
    return `<article class="card unit-card"><div><span class="chip">${unit.published ? "公開中" : "準備中"}</span><h3>${escapeHtml(unit.name)}</h3><p>${escapeHtml(unit.range || "範囲の指定はありません")}</p></div><div class="progress-track" aria-label="進捗 ${value}%"><span style="width:${value}%"></span></div><div class="feature-grid"><button class="feature-button" data-action="study" data-index="${index}"><strong>問題を解く</strong><small>穴埋め・四択</small></button><button class="feature-button" data-action="list" data-index="${index}"><strong>問題一覧</strong><small>答えと解説も確認</small></button><button class="feature-button" data-action="summary" data-index="${index}"><strong>要約</strong><small>全体をつかむ</small></button><button class="feature-button" data-action="points" data-index="${index}"><strong>重要ポイント</strong><small>要点を復習</small></button></div></article>`;
  }).join("");
  grid.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", () => {
    const unit = units[Number(button.dataset.index)];
    const action = button.dataset.action;
    if (action === "study") renderQuestions(root, context, subject, unit);
    if (action === "list") renderQuestionList(root, context, subject, unit);
    if (action === "summary") renderTextContent(root, context, subject, unit, "summary", "要約");
    if (action === "points") renderTextContent(root, context, subject, unit, "important_points", "重要ポイント");
  }));
}

function pageHeader(subject, unit, label) {
  return `<div class="study-header"><button class="back-button" type="button" aria-label="戻る">‹</button><div><span class="brand-mini">${escapeHtml(subject.name)} / ${escapeHtml(unit.name)}</span><h2>${escapeHtml(label)}</h2></div></div>`;
}

function bindBack(root, context, subject) { root.querySelector(".back-button").addEventListener("click", () => renderSubject(root, context, subject)); }

function renderTextContent(root, context, subject, unit, field, label) {
  const items = Array.isArray(unit[field]) ? unit[field] : [];
  root.innerHTML = `${pageHeader(subject, unit, label)}<section class="panel">${items.length ? `<ol class="content-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>` : `<div class="empty">${escapeHtml(label)}はまだ登録されていません。</div>`}</section>`;
  bindBack(root, context, subject);
}

function allQuestions(unit) {
  const fill = (unit.fill_blank || []).map((item, index) => ({ ...item, kind: "穴埋め", type: "fill_blank", sourceIndex: index, displayAnswer: (item.answers || []).join(" / ") }));
  const quiz = (unit.quiz || []).map((item, index) => ({ ...item, kind: "四択", type: "quiz", sourceIndex: index, displayAnswer: item.choices?.[item.answer] || "" }));
  return [...fill, ...quiz];
}

async function showReport(context, subject, unit, item) {
  const reason = await context.choose("どこが違いますか？", ["問題が違います", "答えが違います", "解説が違います"]);
  if (!reason) return;
  const confirmed = await context.confirm(`${reason}として管理者へ送信しますか？`);
  if (!confirmed) return;
  await reportQuestion({ uid: auth.currentUser.uid, subjectId: subject.id, unitId: unit.id, type: item.type, index: item.sourceIndex, reason, question: item.question });
  context.toast("管理者へ送信しました。");
}

function renderQuestionList(root, context, subject, unit) {
  const items = allQuestions(unit);
  root.innerHTML = `${pageHeader(subject, unit, "問題一覧")}<section class="panel"><div class="panel-header"><div><h2>登録されている問題</h2><p>問題・選択肢・答え・解説をまとめて確認できます。</p></div><span class="chip">${items.length}問</span></div><div class="question-catalog">${items.length ? items.map((item, index) => `<details class="question-detail" ${index === 0 ? "open" : ""}><summary><span>${index + 1}</span><strong>${escapeHtml(item.question)}</strong><small>${item.kind}</small></summary><div class="question-detail-body">${item.choices ? `<ol class="choice-preview">${item.choices.map((choice) => `<li>${escapeHtml(choice)}</li>`).join("")}</ol>` : ""}<div class="answer-panel"><strong>答え</strong><p>${escapeHtml(item.displayAnswer)}</p><strong>解説</strong><p>${escapeHtml(item.explanation || "解説は登録されていません。")}</p></div><button class="secondary-button report-button" data-index="${index}" type="button">違います</button></div></details>`).join("") : `<div class="empty">問題はまだ登録されていません。</div>`}</div></section>`;
  bindBack(root, context, subject);
  root.querySelectorAll(".report-button").forEach((button) => button.addEventListener("click", () => showReport(context, subject, unit, items[Number(button.dataset.index)])));
}

async function renderQuestions(root, context, subject, unit) {
  const items = allQuestions(unit);
  if (!items.length) { context.toast("解答できる問題がまだありません。"); return; }
  const oldProgress = await getProgress(auth.currentUser.uid, subject.id, unit.id);
  const questionStats = structuredClone(oldProgress.questionStats || {});
  let attemptCount = Number(oldProgress.attemptCount || 0);
  let correctCount = Number(oldProgress.correctCount || 0);
  let position = 0;
  if (Number(oldProgress.position) > 0 && Number(oldProgress.position) < items.length) {
    const resume = await context.confirm(`${Number(oldProgress.position) + 1}問目から続けますか？`);
    position = resume ? Number(oldProgress.position) : 0;
  }
  const answers = [];
  const show = () => {
    const item = items[position];
    const isQuiz = item.type === "quiz";
    let locked = false;
    root.innerHTML = `${pageHeader(subject, unit, "問題演習")}<section class="panel question-box"><span class="question-number">${position + 1} / ${items.length}・${item.kind}</span><h2 class="question-text">${escapeHtml(item.question)}</h2>${isQuiz ? `<div class="choice-list">${item.choices.map((choice, index) => `<button class="choice-button" data-choice="${index}" type="button"><b>${index + 1}.</b> ${escapeHtml(choice)}</button>`).join("")}</div>` : `<label class="field-label">答え<input id="fillAnswer" class="field" autocomplete="off"><button id="answerButton" class="primary-button" type="button">答え合わせ</button></label>`}<div id="resultArea"></div></section>`;
    bindBack(root, context, subject);
    const submit = async (given) => {
      if (locked) return;
      locked = true;
      const accepted = isQuiz ? Number(given) === Number(item.answer) : (item.answers || []).some((answer) => String(answer).trim().toLowerCase() === String(given).trim().toLowerCase());
      answers.push(accepted);
      const questionKey = `${item.type}:${item.sourceIndex}`;
      const previous = questionStats[questionKey] || {};
      questionStats[questionKey] = {
        attempts: Number(previous.attempts || 0) + 1,
        correct: Number(previous.correct || 0) + (accepted ? 1 : 0),
      };
      attemptCount += 1;
      correctCount += accepted ? 1 : 0;
      try {
        await saveProgress(auth.currentUser.uid, subject.id, unit.id, {
          questionStats,
          attemptCount,
          correctCount,
          total: items.length,
        });
      } catch (error) {
        locked = false;
        context.toast(error.message || "学習結果を保存できませんでした。", true);
        return;
      }
      if (isQuiz) root.querySelectorAll(".choice-button").forEach((button) => { button.disabled = true; const value = Number(button.dataset.choice); if (value === Number(item.answer)) button.classList.add("correct"); else if (value === Number(given)) button.classList.add("wrong"); });
      const result = root.querySelector("#resultArea");
      result.innerHTML = `<div class="answer-panel"><strong>${accepted ? "正解" : "不正解"}</strong><p>答え：${escapeHtml(item.displayAnswer)}</p><p>${escapeHtml(item.explanation || "解説は登録されていません。")}</p></div><div class="inline-actions"><button id="reportButton" class="secondary-button" type="button">違います</button><button id="nextButton" class="primary-button" type="button">${position + 1 < items.length ? "次の問題" : "結果を見る"}</button></div>`;
      result.querySelector("#reportButton").addEventListener("click", () => showReport(context, subject, unit, item));
      result.querySelector("#nextButton").addEventListener("click", async () => {
        await saveProgress(auth.currentUser.uid, subject.id, unit.id, { position: position + 1 < items.length ? position + 1 : 0, answered: Math.min(items.length, Number(oldProgress.answered || 0) + answers.length), total: items.length, lastScore: answers.filter(Boolean).length });
        if (++position < items.length) show(); else renderResult();
      });
    };
    if (isQuiz) root.querySelectorAll(".choice-button").forEach((button) => button.addEventListener("click", () => submit(button.dataset.choice)));
    else {
      const input = root.querySelector("#fillAnswer");
      root.querySelector("#answerButton").addEventListener("click", () => input.value.trim() && submit(input.value));
      input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); root.querySelector("#answerButton").click(); } });
    }
  };
  const renderResult = () => {
    const correct = answers.filter(Boolean).length;
    root.innerHTML = `${pageHeader(subject, unit, "結果")}<section class="panel message-card"><span class="message-icon">✓</span><h2>${correct} / ${answers.length}問 正解</h2><p>今回の問題演習が完了しました。</p><button id="retryButton" class="primary-button" type="button">もう一度解く</button></section>`;
    bindBack(root, context, subject);
    root.querySelector("#retryButton").addEventListener("click", () => renderQuestions(root, context, subject, unit));
  };
  show();
}
