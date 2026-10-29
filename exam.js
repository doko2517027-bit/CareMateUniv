import { auth } from "./firebase.js?v=7";
import { getProgress, getUnit, listCategories, listSubjects, listUnits, reportQuestion, saveProgress, watchUnit } from "./store.js?v=10";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);


let stopVisibleUnitWatch = null;
export function stopStudyUnitWatch() {
  if (stopVisibleUnitWatch) {
    stopVisibleUnitWatch();
    stopVisibleUnitWatch = null;
  }
}
function unitContentSignature(unit) {
  return JSON.stringify({
    name: unit?.name, range: unit?.range, published: unit?.published,
    quiz: unit?.quiz, fill_blank: unit?.fill_blank,
    summary: unit?.summary, important_points: unit?.important_points,
  });
}
function watchDisplayedUnit(root, context, subject, unit, onFresh) {
  stopStudyUnitWatch();
  const pageNode = root.firstElementChild;
  let signature = unitContentSignature(unit);
  const stop = watchUnit(subject.id, unit.id, (fresh) => {
    if (!pageNode?.isConnected || root.firstElementChild !== pageNode) {
      stopStudyUnitWatch();
      return;
    }
    if (!fresh || fresh.published === false) {
      stopStudyUnitWatch();
      context.toast("この単元は現在利用できません。単元一覧に戻ります。", true);
      renderSubject(root, context, subject);
      return;
    }
    const next = unitContentSignature(fresh);
    if (next === signature) return;
    signature = next;
    stopStudyUnitWatch();
    onFresh(fresh);
  }, (error) => {
    context.toast(error?.message || "問題の更新を確認できませんでした。", true);
  });
  stopVisibleUnitWatch = stop;
}

function percent(progress = {}) {
  const answered = Math.max(Number(progress.answered || 0), Object.keys(progress.questionStats || {}).length);
  const total = Number(progress.total || 0);
  return total > 0 ? Math.min(100, Math.round((answered / total) * 100)) : 0;
}

function progressRing(value, label = "進捗") {
  const safe = Math.max(0, Math.min(100, Number(value) || 0));
  return `<span class="progress-ring" style="--progress:${safe}" role="img" aria-label="${escapeHtml(label)} ${safe}%"><span><b>${safe}</b><small>%</small></span></span>`;
}

async function loadSubjectOverview(subjects) {
  const entries = await Promise.all(subjects.map(async (subject) => {
    const units = await listUnits(subject.id, { publishedOnly: true });
    const progressItems = await Promise.all(units.map((unit) => getProgress(auth.currentUser.uid, subject.id, unit.id)));
    const totals = units.reduce((result, unit, index) => {
      const saved = progressItems[index] || {};
      const questionTotal = allQuestions(unit).length || Number(saved.total || 0);
      const answered = Math.min(questionTotal, Math.max(Number(saved.answered || 0), Object.keys(saved.questionStats || {}).length));
      return { answered: result.answered + answered, total: result.total + questionTotal };
    }, { answered: 0, total: 0 });
    return { subject, units, progressItems, value: totals.total ? Math.round((totals.answered / totals.total) * 100) : 0, ...totals };
  }));
  return new Map(entries.map((entry) => [entry.subject.id, entry]));
}

export async function renderTestHome(root, context) {
  stopStudyUnitWatch();
  root.innerHTML = `<section class="hero test-hero"><div><span class="chip">試験対策</span><h2>学習する区分を選択</h2><p>区分から科目、単元へ順番に進みます。</p></div><span class="hero-badge">${escapeHtml(context.profile.name)}</span></section><section class="panel"><div class="panel-header"><div><h2>年度・期間</h2><p>学習したい区分を選んでください。</p></div></div><div id="categoryGrid" class="catalog-navigation"><p class="empty">読み込み中…</p></div></section>`;
  const [categories, subjects] = await Promise.all([listCategories(), listSubjects({ publishedOnly: true })]);
  const grid = root.querySelector("#categoryGrid");
  if (!subjects.length) {
    grid.innerHTML = `<div class="empty"><strong>公開中の問題はまだありません</strong><p>管理者が問題を公開すると、ここに表示されます。</p></div>`;
    return;
  }
  const overview = await loadSubjectOverview(subjects);
  const available = categories.filter((category) => subjects.some((subject) => subject.categoryId === category.id));
  const unclassified = subjects.filter((subject) => !categories.some((category) => category.id === subject.categoryId));
  const entries = [...available.map((category) => ({ ...category, items: subjects.filter((subject) => subject.categoryId === category.id) })), ...(unclassified.length ? [{ id: "__other__", name: "その他", items: unclassified }] : [])]
    .map((category) => {
      const totals = category.items.reduce((result, subject) => {
        const item = overview.get(subject.id) || {};
        return { answered: result.answered + Number(item.answered || 0), total: result.total + Number(item.total || 0) };
      }, { answered: 0, total: 0 });
      return { ...category, count: category.items.length, value: totals.total ? Math.round((totals.answered / totals.total) * 100) : 0 };
    });
  grid.innerHTML = entries.map((category) => `<button class="catalog-navigation-card progress-navigation-card" data-category="${escapeHtml(category.id)}" type="button"><span class="catalog-icon">📚</span><span><strong>${escapeHtml(category.name)}</strong><small>${category.count}科目・学習進捗 ${category.value}%</small><span class="mini-progress"><i style="width:${category.value}%"></i></span></span>${progressRing(category.value, category.name)}<i>›</i></button>`).join("");
  grid.querySelectorAll("[data-category]").forEach((button) => button.addEventListener("click", () => {
    const selected = entries.find((item) => item.id === button.dataset.category);
    const filtered = selected.id === "__other__" ? unclassified : subjects.filter((subject) => subject.categoryId === selected.id);
    renderCategory(root, context, selected, filtered, overview);
  }));
}

async function renderCategory(root, context, category, subjects, knownOverview = null) {
  stopStudyUnitWatch();
  root.innerHTML = `<div class="study-header"><button class="back-button" type="button" aria-label="区分一覧へ戻る">‹</button><div><span class="brand-mini">CATEGORY</span><h2>${escapeHtml(category.name)}</h2><p>${subjects.length}科目</p></div></div><section class="panel"><div class="panel-header"><div><h2>科目一覧</h2><p>科目ごとの解答進捗を確認できます。</p></div></div><div id="subjectGrid" class="catalog-navigation"><p class="empty">進捗を読み込み中…</p></div></section>`;
  root.querySelector(".back-button").addEventListener("click", () => renderTestHome(root, context));
  const overview = knownOverview || await loadSubjectOverview(subjects);
  const subjectGrid = root.querySelector("#subjectGrid");
  subjectGrid.innerHTML = subjects.map((subject) => {
    const item = overview.get(subject.id) || { value: 0, units: [] };
    return `<button class="catalog-navigation-card progress-navigation-card" data-subject="${escapeHtml(subject.id)}" type="button"><span class="catalog-icon">📖</span><span><strong>${escapeHtml(subject.name)}</strong><small>${item.units.length}単元・解答進捗 ${item.value}%</small><span class="mini-progress"><i style="width:${item.value}%"></i></span></span>${progressRing(item.value, subject.name)}<i>›</i></button>`;
  }).join("");
  root.querySelectorAll("[data-subject]").forEach((button) => button.addEventListener("click", () => {
    const subject = subjects.find((item) => item.id === button.dataset.subject);
    subject._navigationParent = { category, subjects };
    renderSubject(root, context, subject, subject._navigationParent);
  }));
}

async function renderSubject(root, context, subject, parent = null) {
  stopStudyUnitWatch();
  parent ||= subject._navigationParent || null;
  root.innerHTML = `<div class="study-header"><button class="back-button" type="button" aria-label="戻る">‹</button><div><span class="brand-mini">SUBJECT</span><h2>${escapeHtml(subject.name)}</h2></div></div><section class="panel"><div class="panel-header"><div><h2>単元</h2><p>学習内容を選択してください。</p></div></div><div id="unitGrid" class="grid"><p class="empty">読み込み中…</p></div></section>`;
  root.querySelector(".back-button").addEventListener("click", () => parent ? renderCategory(root, context, parent.category, parent.subjects) : renderTestHome(root, context));
  const units = await listUnits(subject.id, { publishedOnly: true });
  const progressItems = await Promise.all(units.map((unit) => getProgress(auth.currentUser.uid, subject.id, unit.id)));
  const grid = root.querySelector("#unitGrid");
  if (!units.length) { grid.innerHTML = `<div class="empty">公開中の単元はまだありません。</div>`; return; }
  grid.innerHTML = units.map((unit, index) => {
    const value = percent(progressItems[index]);
    const total = Number(progressItems[index]?.total || allQuestions(unit).length);
    const answered = Math.min(total, Math.max(Number(progressItems[index]?.answered || 0), Object.keys(progressItems[index]?.questionStats || {}).length));
    return `<article class="card unit-card"><div class="unit-progress-heading"><div><span class="chip">${unit.published ? "公開中" : "準備中"}</span><h3>${escapeHtml(unit.name)}</h3><p>${escapeHtml(unit.range || "範囲の指定はありません")}</p></div>${progressRing(value, unit.name)}</div><div class="progress-summary"><strong>解答進捗 ${value}%</strong><span>${answered} / ${total}問</span></div><div class="progress-track" aria-label="進捗 ${value}%"><span style="width:${value}%"></span></div><div class="feature-grid"><button class="feature-button" data-action="study" data-index="${index}"><strong>問題を解く</strong><small>穴埋め・四択</small></button><button class="feature-button" data-action="list" data-index="${index}"><strong>問題一覧</strong><small>答えと解説も確認</small></button><button class="feature-button" data-action="summary" data-index="${index}"><strong>要約</strong><small>全体をつかむ</small></button><button class="feature-button" data-action="points" data-index="${index}"><strong>重要ポイント</strong><small>要点を復習</small></button></div></article>`;
  }).join("");
  grid.querySelectorAll("[data-action]").forEach((button) => button.addEventListener("click", async () => {
    if (button.disabled) return;
    const unit = units[Number(button.dataset.index)];
    const action = button.dataset.action;
    button.disabled = true;
    try {
      const latest = await getUnit(subject.id, unit.id);
      if (!latest?.published) throw new Error("この単元は現在利用できません。");
      if (action === "study") await renderQuestions(root, context, subject, latest);
      if (action === "list") renderQuestionList(root, context, subject, latest);
      if (action === "summary") renderTextContent(root, context, subject, latest, "summary", "要約");
      if (action === "points") renderTextContent(root, context, subject, latest, "important_points", "重要ポイント");
    } catch (error) {
      context.toast(error?.message || "最新の問題を取得できませんでした。", true);
    } finally {
      button.disabled = false;
    }
  }));
}

function pageHeader(subject, unit, label) {
  return `<div class="study-header"><button class="back-button" type="button" aria-label="戻る">‹</button><div><span class="brand-mini">${escapeHtml(subject.name)} / ${escapeHtml(unit.name)}</span><h2>${escapeHtml(label)}</h2></div></div>`;
}

function bindBack(root, context, subject) { root.querySelector(".back-button").addEventListener("click", () => renderSubject(root, context, subject)); }

function renderQuestionImage(item) {
  const url = String(item?.imageUrl || "").trim();
  if (!url) return "";
  const description = String(item?.imageDescription || "").trim();
  return `<figure class="test-question-image"><img src="${escapeHtml(url)}" alt="${escapeHtml(description || "問題画像")}" loading="lazy">${description ? `<figcaption>${escapeHtml(description)}</figcaption>` : ""}</figure>`;
}

function renderTextContent(root, context, subject, unit, field, label) {
  stopStudyUnitWatch();
  const items = Array.isArray(unit[field]) ? unit[field] : [];
  root.innerHTML = `${pageHeader(subject, unit, label)}<section class="panel">${items.length ? `<ol class="content-list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ol>` : `<div class="empty">${escapeHtml(label)}はまだ登録されていません。</div>`}</section>`;
  bindBack(root, context, subject);
  watchDisplayedUnit(root, context, subject, unit, (fresh) => renderTextContent(root, context, subject, fresh, field, label));
}

function allQuestions(unit) {
  const fill = (unit.fill_blank || []).map((item, index) => ({ ...item, kind: "穴埋め", type: "fill_blank", sourceIndex: index, displayAnswer: item.answer || (item.answers || []).join(" / ") }));
  const quiz = (unit.quiz || []).map((item, index) => {
    const correct = Array.isArray(item.answers) && item.answers.length ? item.answers.map(Number) : [Number(item.answer) || 0];
    return { ...item, answers: correct, kind: correct.length > 1 ? "複数選択" : "選択問題", type: "quiz", sourceIndex: index, displayAnswer: correct.map((value) => item.choices?.[value]).filter(Boolean).join(" / ") };
  });
  return [...fill, ...quiz];
}

async function showReport(context, subject, unit, item) {
  const report = await context.report();
  if (!report) return;
  try {
    context.loading(true, "修正依頼を送信中…");
    await reportQuestion({ uid: auth.currentUser.uid, studentNumber: context.profile?.studentNumber, reporterName: context.profile?.name, subjectId: subject.id, unitId: unit.id, type: item.type, index: item.sourceIndex, reason: report.reason, details: report.details, question: item.question });
    context.toast("管理者へ修正依頼を送信しました。");
  } catch (error) {
    context.toast(error?.message || "修正依頼を送信できませんでした。", true);
  } finally {
    context.loading(false);
  }
}

function renderQuestionList(root, context, subject, unit, expandedIndices = [0]) {
  stopStudyUnitWatch();
  const items = allQuestions(unit);
  root.innerHTML = `${pageHeader(subject, unit, "問題一覧")}<section class="panel"><div class="panel-header"><div><h2>登録されている問題</h2><p>問題・選択肢・答え・解説をまとめて確認できます。</p></div><span class="chip">${items.length}問</span></div><div class="question-catalog">${items.length ? items.map((item, index) => `<details class="question-detail" ${expandedIndices.includes(index) ? "open" : ""}><summary><span>${index + 1}</span><strong>${escapeHtml(item.question)}</strong><small>${item.kind}</small></summary><div class="question-detail-body">${renderQuestionImage(item)}${item.choices ? `<ol class="choice-preview">${item.choices.map((choice) => `<li>${escapeHtml(choice)}</li>`).join("")}</ol>` : ""}<div class="answer-panel"><strong>答え</strong><p>${escapeHtml(item.displayAnswer)}</p><strong>解説</strong><p>${escapeHtml(item.explanation || "解説は登録されていません。")}</p></div><button class="secondary-button report-button" data-index="${index}" type="button">違います</button></div></details>`).join("") : `<div class="empty">問題はまだ登録されていません。</div>`}</div></section>`;
  bindBack(root, context, subject);
  root.querySelectorAll(".report-button").forEach((button) => button.addEventListener("click", () => showReport(context, subject, unit, items[Number(button.dataset.index)])));
  watchDisplayedUnit(root, context, subject, unit, (fresh) => {
    const expanded = [...root.querySelectorAll(".question-detail")].flatMap((element, index) => element.open ? [index] : []);
    renderQuestionList(root, context, subject, fresh, expanded);
  });
}

async function renderQuestions(root, context, subject, unit) {
  stopStudyUnitWatch();
  const fresh = await getUnit(subject.id, unit.id);
  if (!fresh?.published) throw new Error("この単元は現在利用できません。");
  unit = fresh;
  let items = allQuestions(unit);
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
    const correctAnswers = isQuiz ? (Array.isArray(item.answers) && item.answers.length ? item.answers.map(Number) : [Number(item.answer) || 0]) : [];
    const isMultiple = isQuiz && correctAnswers.length > 1;
    const fillAnswers = !isQuiz && Array.isArray(item.answers) && item.answers.length ? item.answers : [item.answer || ""];
    let locked = false;
    const progressValue = Math.round(((position + 1) / items.length) * 100);
    root.innerHTML = `${pageHeader(subject, unit, "問題演習")}<div class="test-progress" aria-label="${position + 1}問目 / ${items.length}問"><span style="width:${progressValue}%"></span></div><section class="panel question-box test-focus-card"><div class="test-context-line"><b>${escapeHtml(subject.name)}</b><span>›</span><span>${escapeHtml(unit.name)}</span></div><div class="test-question-heading"><span class="test-content-label">問題</span><div class="test-question-number">${position + 1} / ${items.length}</div></div><h2 class="question-text test-question-text">${escapeHtml(item.question)}</h2>${renderQuestionImage(item)}${isQuiz ? `<section class="test-content-section"><div class="test-content-section-heading"><span class="test-content-label">選択肢</span><small>${isMultiple ? "当てはまるものをすべて選択" : "1つ選択"}</small></div><div class="choice-list test-choice-list">${item.choices.map((choice, index) => `<button class="choice-button test-choice" data-choice="${index}" type="button" aria-pressed="false"><b>${index + 1}</b><span>${escapeHtml(choice)}</span></button>`).join("")}</div></section>${isMultiple ? `<button id="answerButton" class="primary-button full-action" type="button" disabled>選択した答えを判定</button>` : ""}` : `<section class="test-content-section"><div class="test-content-section-heading"><span class="test-content-label">解答</span><small>${fillAnswers.length > 1 ? `${fillAnswers.length}か所すべて入力` : "答えを入力"}</small></div><div class="fill-answer-list test-fill-inputs">${fillAnswers.map((_, index) => `<label class="field-label">解答 ${index + 1}<input class="field fill-answer-input" autocomplete="off"></label>`).join("")}</div></section><button id="answerButton" class="primary-button full-action" type="button">答え合わせ</button>`}<div id="resultArea"></div><button id="questionReportButton" class="test-report-link" type="button">違います</button></section>`;
    bindBack(root, context, subject);
    root.querySelector("#questionReportButton").addEventListener("click", () => showReport(context, subject, unit, item));
    const submit = async (given) => {
      if (locked) return;
      locked = true;
      const selected = isQuiz ? (Array.isArray(given) ? given.map(Number).sort((a, b) => a - b) : [Number(given)]) : [];
      const normalizedGiven = isQuiz ? [] : (Array.isArray(given) ? given : [given]).map((value) => String(value).trim().toLowerCase()).filter(Boolean);
      const normalizedCorrect = isQuiz ? [] : fillAnswers.map((value) => String(value).trim().toLowerCase()).filter(Boolean);
      const accepted = isQuiz
        ? selected.length === correctAnswers.length && correctAnswers.every((value) => selected.includes(value))
        : normalizedGiven.length === normalizedCorrect.length && normalizedCorrect.every((value) => normalizedGiven.includes(value));
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
      if (isQuiz) root.querySelectorAll(".choice-button").forEach((button) => { button.disabled = true; const value = Number(button.dataset.choice); if (correctAnswers.includes(value)) button.classList.add("correct"); else if (selected.includes(value)) button.classList.add("wrong"); });
      const result = root.querySelector("#resultArea");
      result.innerHTML = `<section class="test-result-panel ${accepted ? "is-correct" : "is-wrong"}"><div class="test-result-summary"><div class="test-mark" aria-hidden="true">${accepted ? "○" : "×"}</div><div><strong>${accepted ? "正解" : "不正解"}</strong><small>${accepted ? "その調子です" : "答えと解説を確認しましょう"}</small></div></div><div class="answer-panel test-answer-explanation"><span class="test-content-label">答え</span><p>${escapeHtml(item.displayAnswer)}</p><span class="test-content-label">解説</span><p>${escapeHtml(item.explanation || "解説は登録されていません。")}</p></div><button id="nextButton" class="primary-button full-action" type="button">${position + 1 < items.length ? "次の問題" : "結果を見る"}</button></section>`;
      result.querySelector("#nextButton").addEventListener("click", async () => {
        await saveProgress(auth.currentUser.uid, subject.id, unit.id, { position: position + 1 < items.length ? position + 1 : 0, answered: Math.min(items.length, Number(oldProgress.answered || 0) + answers.length), total: items.length, lastScore: answers.filter(Boolean).length });
        if (++position < items.length) show(); else renderResult();
      });
    };
    if (isQuiz) {
      root.querySelectorAll(".choice-button").forEach((button) => button.addEventListener("click", () => {
        if (!isMultiple) { submit(button.dataset.choice); return; }
        button.classList.toggle("selected");
        button.setAttribute("aria-pressed", button.classList.contains("selected") ? "true" : "false");
        root.querySelector("#answerButton").disabled = !root.querySelector(".choice-button.selected");
      }));
      if (isMultiple) root.querySelector("#answerButton").addEventListener("click", () => submit([...root.querySelectorAll(".choice-button.selected")].map((button) => Number(button.dataset.choice))));
    } else {
      const inputs = [...root.querySelectorAll(".fill-answer-input")];
      root.querySelector("#answerButton").addEventListener("click", () => { const values = inputs.map((input) => input.value.trim()); if (values.every(Boolean)) submit(values); });
      inputs.forEach((input) => input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); root.querySelector("#answerButton").click(); } }));
    }
  };
  const renderResult = () => {
    stopStudyUnitWatch();
    const correct = answers.filter(Boolean).length;
    root.innerHTML = `${pageHeader(subject, unit, "結果")}<section class="panel message-card"><span class="message-icon">✓</span><h2>${correct} / ${answers.length}問 正解</h2><p>今回の問題演習が完了しました。</p><button id="retryButton" class="primary-button" type="button">もう一度解く</button></section>`;
    bindBack(root, context, subject);
    root.querySelector("#retryButton").addEventListener("click", () => renderQuestions(root, context, subject, unit));
  };
  show();
  watchDisplayedUnit(root, context, subject, unit, (latest) => {
    // All following questions use the fresh published source. The already
    // displayed question is left untouched until the student opts to reload.
    items = allQuestions(latest);
    unit = latest;
    const notice = document.createElement("section");
    notice.className = "study-update-banner";
    notice.setAttribute("role", "status");
    notice.innerHTML = '<div><strong>問題が更新されました</strong><p>最新の問題・正解・解説で学習を続けるには、読み込み直してください。</p></div><button class="primary-button" type="button">最新の内容を表示</button>';
    root.insertBefore(notice, root.firstElementChild);
    notice.querySelector("button").addEventListener("click", () => {
      renderQuestions(root, context, subject, latest).catch((error) => context.toast(error.message || "再読み込みできませんでした。", true));
    });
  });
}
