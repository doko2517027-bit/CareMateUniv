import { auth, isAdminAuthEmail } from "./firebase.js";
import {
  authErrorMessage,
  authReady,
  beginAdminRegistration,
  changeOwnPassword,
  completeStudentRegistration,
  discardIncompleteAdminAccount,
  finishAdminRegistration,
  getCurrentProfile,
  loginAccount,
  logout,
  requestPasswordReset,
  refreshVerification,
  registerStudentAccount,
  resendVerification,
} from "./auth.js";
import { renderTestHome } from "./exam.js";
import { parseUnitJson, renderAdmin, renderPersonalAnalytics } from "./admin.js";
import { watchOpenQuestionReports } from "./store.js";

const $ = (selector, root = document) => root.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const screens = ["#authScreen", "#verifyScreen", "#activationScreen", "#adminPasswordScreen", "#appShell"];
let profile = null;
let currentPage = "test";
let toastTimer = null;
let stopReportWatch = null;
let knownOpenReportIds = new Set();

function showOnly(selector) { screens.forEach((item) => { $(item).hidden = item !== selector; }); }
function loading(show, message = "読み込み中…") { $("#loadingMessage").textContent = message; $("#loadingOverlay").hidden = !show; }
function status(element, message = "", error = false) { element.textContent = message; element.className = `status${message ? error ? " error" : " success" : ""}`; }
function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message; element.style.background = error ? "#a92638" : "#172033"; element.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { element.hidden = true; }, 3400);
}

function openDialog(html) {
  $("#dialogContent").innerHTML = html;
  const dialog = $("#appDialog");
  if (!dialog.open) dialog.showModal();
  return dialog;
}
function closeDialog() { if ($("#appDialog").open) $("#appDialog").close(); }
function show(html) { return new Promise((resolve) => { openDialog(html); const finish = () => { $("#appDialog").removeEventListener("close", finish); resolve(); }; $("#appDialog").addEventListener("close", finish); }); }
function confirmDialog(message) {
  return new Promise((resolve) => {
    const dialog = openDialog(`<h2>確認</h2><p>${escapeHtml(message)}</p><div class="inline-actions"><button id="dialogCancel" class="secondary-button" type="button">キャンセル</button><button id="dialogConfirm" class="primary-button" type="button">続ける</button></div>`);
    const done = (value) => { dialog.onclose = null; closeDialog(); resolve(value); };
    $("#dialogCancel").onclick = () => done(false); $("#dialogConfirm").onclick = () => done(true); dialog.onclose = () => resolve(false);
  });
}
function chooseDialog(title, choices) {
  return new Promise((resolve) => {
    const dialog = openDialog(`<h2>${escapeHtml(title)}</h2><div class="choice-list">${choices.map((choice, index) => `<button class="choice-button" data-select="${index}" type="button">${escapeHtml(choice)}</button>`).join("")}</div>`);
    const done = (value) => { dialog.onclose = null; closeDialog(); resolve(value); };
    dialog.querySelectorAll("[data-select]").forEach((button) => button.addEventListener("click", () => done(choices[Number(button.dataset.select)])));
    dialog.onclose = () => resolve(null);
  });
}
function reportDialog() {
  return new Promise((resolve) => {
    const dialog = openDialog(`<form id="reportForm" class="form-stack report-form"><h2>何が違いますか？</h2><p class="hint">該当する項目を選び、必要なら修正内容を入力してください。</p><div class="report-reason-grid" role="group" aria-label="修正する項目"><button data-report-reason="問題が違います" type="button">問題が違います</button><button data-report-reason="答えが違います" type="button">答えが違います</button><button data-report-reason="解説が違います" type="button">解説が違います</button></div><label>修正内容（任意）<textarea name="details" rows="5" maxlength="1200" placeholder="どこが違うか、正しい内容などを入力できます"></textarea><small class="field-note">1,200文字まで</small></label><div class="inline-actions"><button id="reportCancel" class="secondary-button" type="button">キャンセル</button><button class="primary-button" type="submit">管理者へ送信</button></div><p id="reportFormStatus" class="status"></p></form>`);
    let reason = "";
    const done = (value) => { dialog.onclose = null; closeDialog(); resolve(value); };
    dialog.querySelectorAll("[data-report-reason]").forEach((button) => button.addEventListener("click", () => {
      reason = button.dataset.reportReason;
      dialog.querySelectorAll("[data-report-reason]").forEach((item) => item.classList.toggle("active", item === button));
    }));
    $("#reportCancel").onclick = () => done(null);
    $("#reportForm").onsubmit = (event) => {
      event.preventDefault();
      if (!reason) { status($("#reportFormStatus"), "違う箇所を選択してください。", true); return; }
      done({ reason, details: event.currentTarget.elements.details.value.trim() });
    };
    dialog.onclose = () => resolve(null);
  });
}
async function enableAdminNotifications() {
  if (!("Notification" in window)) { toast("このブラウザは通知に対応していません。", true); return "unsupported"; }
  const permission = await Notification.requestPermission();
  if (permission === "granted") toast("管理者向けの修正依頼通知を有効にしました。");
  else toast("ブラウザ設定で通知を許可してください。", true);
  return permission;
}
function formDialog(title, fields, submitLabel = "保存") {
  return new Promise((resolve) => {
    const inputHtml = fields.map((field) => {
      if (field.type === "checkbox") return `<label class="checkbox-row"><input name="${escapeHtml(field.name)}" type="checkbox" ${field.value ? "checked" : ""}>${escapeHtml(field.label)}</label>`;
      if (field.type === "select") return `<label>${escapeHtml(field.label)}<select name="${escapeHtml(field.name)}">${field.options.map((option) => `<option value="${escapeHtml(option.value)}" ${String(option.value) === String(field.value) ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select></label>`;
      return `<label>${escapeHtml(field.label)}<input name="${escapeHtml(field.name)}" type="${escapeHtml(field.type || "text")}" value="${escapeHtml(field.value || "")}" ${field.required ? "required" : ""}></label>`;
    }).join("");
    const dialog = openDialog(`<form id="modalForm" class="form-stack"><h2>${escapeHtml(title)}</h2>${inputHtml}<div class="inline-actions"><button id="modalCancel" class="secondary-button" type="button">キャンセル</button><button class="primary-button" type="submit">${escapeHtml(submitLabel)}</button></div></form>`);
    const done = (value) => { dialog.onclose = null; closeDialog(); resolve(value); };
    $("#modalCancel").onclick = () => done(null);
    $("#modalForm").onsubmit = (event) => { event.preventDefault(); const result = Object.fromEntries(new FormData(event.currentTarget)); fields.filter((field) => field.type === "checkbox").forEach((field) => { result[field.name] = event.currentTarget.elements[field.name].checked; }); done(result); };
    dialog.onclose = () => resolve(null);
  });
}

function questionImageEditor(item = {}) {
  const url = String(item.imageUrl || "");
  const description = String(item.imageDescription || "");
  return `<section class="question-image-editor">
    <div class="editor-section-heading"><strong>問題画像</strong><small>任意・10MB以下</small></div>
    <input data-role="image-file" type="file" accept="image/*">
    <input data-role="image-url" type="hidden" value="${escapeHtml(url)}">
    <input data-role="image-public-id" type="hidden" value="${escapeHtml(item.imagePublicId || "")}">
    <label>画像の説明<textarea data-role="image-description" rows="2" placeholder="画像の内容を文章で説明">${escapeHtml(description)}</textarea></label>
    <div class="question-image-preview" data-role="image-preview">${url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(description || "問題画像")}"><button class="danger-button" data-action="remove-image" type="button">画像を削除</button>` : `<small>画像は登録されていません。</small>`}</div>
  </section>`;
}

function fillQuestionEditor(item = {}, index = 0) {
  const answers = Array.isArray(item.answers) && item.answers.length ? item.answers : [item.answer || ""];
  return `<article class="question-editor" data-kind="fill">
    <div class="editor-section-heading"><strong>穴埋め問題 ${index + 1}</strong><button class="danger-button compact-button" data-action="delete-question" type="button">削除</button></div>
    <label>問題文<textarea data-role="question" rows="3" placeholder="問題文を入力してください">${escapeHtml(item.question || "")}</textarea></label>
    ${questionImageEditor(item)}
    <label>模範解答の表示<input data-role="display-answer" value="${escapeHtml(item.answer || answers.join("・"))}" placeholder="例：心拍出量"></label>
    <div class="answer-editor" data-role="fill-answers"><div class="editor-section-heading"><strong>穴埋め解答欄</strong><small>複数の空欄にも対応</small></div>${answers.map((answer, answerIndex) => `<div class="editor-input-row"><input data-role="fill-answer" value="${escapeHtml(answer)}" placeholder="解答 ${answerIndex + 1}"><button class="danger-button compact-button" data-action="delete-fill-answer" type="button" aria-label="解答欄を削除">−</button></div>`).join("")}</div>
    <button class="secondary-button" data-action="add-fill-answer" type="button">＋ 解答欄を追加</button>
    <label>解説<textarea data-role="explanation" rows="3" placeholder="答えの理由や補足を入力">${escapeHtml(item.explanation || "")}</textarea></label>
  </article>`;
}

function quizChoiceEditor(choice = "", correct = false, index = 0) {
  return `<div class="editor-input-row quiz-choice-row"><label class="correct-choice"><input data-role="quiz-correct" type="checkbox" ${correct ? "checked" : ""}><span>正解</span></label><input data-role="quiz-choice" value="${escapeHtml(choice)}" placeholder="選択肢 ${index + 1}"><button class="danger-button compact-button" data-action="delete-choice" type="button" aria-label="選択肢を削除">−</button></div>`;
}

function quizQuestionEditor(item = {}, index = 0) {
  const choices = Array.isArray(item.choices) && item.choices.length ? item.choices : ["", "", "", ""];
  const correct = Array.isArray(item.answers) && item.answers.length ? item.answers.map(Number) : [Number(item.answer) || 0];
  return `<article class="question-editor" data-kind="quiz">
    <div class="editor-section-heading"><strong>選択問題 ${index + 1}</strong><button class="danger-button compact-button" data-action="delete-question" type="button">削除</button></div>
    <label>問題文<textarea data-role="question" rows="3" placeholder="問題文を入力してください">${escapeHtml(item.question || "")}</textarea></label>
    ${questionImageEditor(item)}
    <div class="answer-editor" data-role="quiz-choices"><div class="editor-section-heading"><strong>選択肢・答え</strong><small>正解を複数選択できます</small></div>${choices.map((choice, choiceIndex) => quizChoiceEditor(choice, correct.includes(choiceIndex), choiceIndex)).join("")}</div>
    <button class="secondary-button" data-action="add-choice" type="button">＋ 選択肢を追加</button>
    <label>解説<textarea data-role="explanation" rows="3" placeholder="答えの理由や補足を入力">${escapeHtml(item.explanation || "")}</textarea></label>
  </article>`;
}

function readQuestionImage(card) {
  return {
    imageUrl: card.querySelector('[data-role="image-url"]')?.value.trim() || "",
    imagePublicId: card.querySelector('[data-role="image-public-id"]')?.value.trim() || "",
    imageDescription: card.querySelector('[data-role="image-description"]')?.value.trim() || "",
  };
}

async function uploadQuestionImage(file, editor, context) {
  if (!String(file?.type || "").startsWith("image/")) throw new Error("画像ファイルを選択してください。");
  if (file.size > 10 * 1024 * 1024) throw new Error("画像は10MB以下にしてください。");
  const preview = editor.querySelector('[data-role="image-preview"]');
  preview.innerHTML = `<small>画像をアップロードしています…</small>`;
  const body = new FormData();
  body.append("file", file);
  body.append("upload_preset", "caremate_upload");
  const response = await fetch("https://api.cloudinary.com/v1_1/vpctonjf/image/upload", { method: "POST", body });
  const result = await response.json();
  if (!response.ok || !result.secure_url) throw new Error(result.error?.message || "画像をアップロードできませんでした。");
  editor.querySelector('[data-role="image-url"]').value = result.secure_url;
  editor.querySelector('[data-role="image-public-id"]').value = result.public_id || "";
  const description = editor.querySelector('[data-role="image-description"]').value.trim();
  preview.innerHTML = `<img src="${escapeHtml(result.secure_url)}" alt="${escapeHtml(description || "問題画像")}"><button class="danger-button" data-action="remove-image" type="button">画像を削除</button>`;
  context.toast("画像を追加しました。");
}

function unitEditor(unit = {}, context, target = null) {
  return new Promise((resolve) => {
    const editorHtml = `<form id="unitEditorForm" class="form-stack admin-editor"><div class="editor-title"><div><span class="chip">問題編集</span><h2>${escapeHtml(unit.name || "単元")}</h2></div><small>「今日の一問」は使用しません</small></div><section class="editor-block"><div class="split"><label>単元名<input name="name" value="${escapeHtml(unit.name || "")}" required maxlength="100"></label><label>表示順<input name="order" type="number" value="${Number(unit.order) || 0}"></label></div><label>試験範囲<input name="range" value="${escapeHtml(unit.range || "")}" maxlength="300"></label><label class="checkbox-row"><input name="published" type="checkbox" ${unit.published ? "checked" : ""}>学生に公開する</label></section><details class="editor-block" open><summary>要約・重要ポイント</summary><label>要約（1行につき1項目）<textarea name="summary" rows="4">${escapeHtml((unit.summary || []).join("\n"))}</textarea></label><label>重要ポイント（1行につき1項目）<textarea name="important_points" rows="4">${escapeHtml((unit.important_points || []).join("\n"))}</textarea></label></details><details class="editor-block" open><summary>穴埋め問題 <span id="fillCount" class="chip"></span></summary><div id="fillQuestionList" class="editor-question-list"></div><button id="addFillQuestion" class="secondary-button" type="button">＋ 穴埋め問題を作成</button></details><details class="editor-block" open><summary>選択問題 <span id="quizCount" class="chip"></span></summary><div id="quizQuestionList" class="editor-question-list"></div><button id="addQuizQuestion" class="secondary-button" type="button">＋ 選択問題を作成</button></details><details class="editor-block"><summary>JSON一括読み込み</summary><p class="hint">summary / important_points / fill_blank / quiz の既存形式を読み込めます。今日の一問は取り込みません。</p><textarea id="fullJson" class="code-area" rows="8" placeholder='{"summary":[],"important_points":[],"fill_blank":[],"quiz":[]}'></textarea><button id="applyJson" class="secondary-button" type="button">JSONを編集画面へ反映</button></details><div class="editor-sticky-actions"><button id="unitCancel" class="secondary-button" type="button">単元一覧へ戻る</button><button class="primary-button" type="submit">問題を保存</button></div><p id="unitStatus" class="status"></p></form>`;
    let dialog = null;
    const host = target || $("#dialogContent");
    if (target) host.innerHTML = editorHtml;
    else dialog = openDialog(editorHtml);
    const form = $("#unitEditorForm", host);
    const fillList = $("#fillQuestionList");
    const quizList = $("#quizQuestionList");
    const updateLabels = () => {
      fillList.querySelectorAll('[data-kind="fill"]').forEach((card, index) => { card.querySelector(".editor-section-heading strong").textContent = `穴埋め問題 ${index + 1}`; });
      quizList.querySelectorAll('[data-kind="quiz"]').forEach((card, index) => { card.querySelector(".editor-section-heading strong").textContent = `選択問題 ${index + 1}`; });
      $("#fillCount").textContent = `${fillList.children.length}問`;
      $("#quizCount").textContent = `${quizList.children.length}問`;
    };
    const renderQuestions = (data = {}) => {
      fillList.innerHTML = (data.fill_blank || []).map(fillQuestionEditor).join("");
      quizList.innerHTML = (data.quiz || []).map(quizQuestionEditor).join("");
      updateLabels();
    };
    const done = (value) => { if (dialog) { dialog.onclose = null; closeDialog(); } resolve(value); };
    renderQuestions(unit);
    $("#unitCancel").onclick = () => done(null);
    $("#addFillQuestion").onclick = () => { fillList.insertAdjacentHTML("beforeend", fillQuestionEditor({}, fillList.children.length)); updateLabels(); };
    $("#addQuizQuestion").onclick = () => { quizList.insertAdjacentHTML("beforeend", quizQuestionEditor({}, quizList.children.length)); updateLabels(); };
    form.addEventListener("click", (event) => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (!action) return;
      const card = event.target.closest(".question-editor");
      if (action === "delete-question") { card.remove(); updateLabels(); }
      if (action === "add-fill-answer") {
        const area = card.querySelector('[data-role="fill-answers"]');
        const index = area.querySelectorAll('[data-role="fill-answer"]').length;
        area.insertAdjacentHTML("beforeend", `<div class="editor-input-row"><input data-role="fill-answer" placeholder="解答 ${index + 1}"><button class="danger-button compact-button" data-action="delete-fill-answer" type="button" aria-label="解答欄を削除">−</button></div>`);
      }
      if (action === "delete-fill-answer") {
        const area = event.target.closest('[data-role="fill-answers"]');
        if (area.querySelectorAll('[data-role="fill-answer"]').length > 1) event.target.closest(".editor-input-row").remove();
        else context.toast("解答欄は1つ以上必要です。", true);
      }
      if (action === "add-choice") {
        const area = card.querySelector('[data-role="quiz-choices"]');
        const index = area.querySelectorAll(".quiz-choice-row").length;
        area.insertAdjacentHTML("beforeend", quizChoiceEditor("", false, index));
      }
      if (action === "delete-choice") {
        const area = event.target.closest('[data-role="quiz-choices"]');
        if (area.querySelectorAll(".quiz-choice-row").length > 2) event.target.closest(".quiz-choice-row").remove();
        else context.toast("選択肢は2つ以上必要です。", true);
      }
      if (action === "remove-image") {
        const editor = event.target.closest(".question-image-editor");
        editor.querySelector('[data-role="image-url"]').value = "";
        editor.querySelector('[data-role="image-public-id"]').value = "";
        editor.querySelector('[data-role="image-file"]').value = "";
        editor.querySelector('[data-role="image-preview"]').innerHTML = `<small>画像は登録されていません。</small>`;
      }
    });
    form.addEventListener("change", async (event) => {
      if (!event.target.matches('[data-role="image-file"]') || !event.target.files?.[0]) return;
      event.target.disabled = true;
      try { await uploadQuestionImage(event.target.files[0], event.target.closest(".question-image-editor"), context); }
      catch (error) { context.toast(error.message, true); event.target.closest('[data-role="image-preview"]').innerHTML = `<small>アップロードに失敗しました。</small>`; }
      finally { event.target.disabled = false; }
    });
    $("#applyJson").onclick = () => {
      try {
        const parsed = parseUnitJson($("#fullJson").value);
        form.elements.summary.value = parsed.summary.join("\n");
        form.elements.important_points.value = parsed.important_points.join("\n");
        renderQuestions(parsed);
        status($("#unitStatus"), "JSONを編集画面へ反映しました。");
      } catch (error) { status($("#unitStatus"), error.message, true); }
    };
    form.onsubmit = (event) => {
      event.preventDefault();
      const fill_blank = [...fillList.querySelectorAll('[data-kind="fill"]')].map((card) => {
        const answers = [...card.querySelectorAll('[data-role="fill-answer"]')].map((input) => input.value.trim()).filter(Boolean);
        return { question: card.querySelector('[data-role="question"]').value.trim(), answer: card.querySelector('[data-role="display-answer"]').value.trim() || answers.join("・"), answers, explanation: card.querySelector('[data-role="explanation"]').value.trim(), ...readQuestionImage(card) };
      });
      const quiz = [...quizList.querySelectorAll('[data-kind="quiz"]')].map((card) => {
        const rows = [...card.querySelectorAll(".quiz-choice-row")];
        const choices = rows.map((row) => row.querySelector('[data-role="quiz-choice"]').value.trim());
        const answers = rows.map((row, index) => row.querySelector('[data-role="quiz-correct"]').checked ? index : -1).filter((index) => index >= 0);
        return { question: card.querySelector('[data-role="question"]').value.trim(), choices, answer: answers[0] ?? 0, ...(answers.length > 1 ? { answers } : {}), explanation: card.querySelector('[data-role="explanation"]').value.trim(), ...readQuestionImage(card) };
      });
      if (fill_blank.some((item) => !item.question || !item.answers.length)) { status($("#unitStatus"), "穴埋め問題の問題文と解答を入力してください。", true); return; }
      if (quiz.some((item) => !item.question || item.choices.length < 2 || item.choices.some((choice) => !choice) || !Array.isArray(item.answers) && !Number.isInteger(item.answer))) { status($("#unitStatus"), "選択問題の問題文・2つ以上の選択肢・正解を入力してください。", true); return; }
      const quizWithoutAnswer = [...quizList.querySelectorAll('[data-kind="quiz"]')].some((card) => !card.querySelector('[data-role="quiz-correct"]:checked'));
      if (quizWithoutAnswer) { status($("#unitStatus"), "選択問題ごとに正解を1つ以上選んでください。", true); return; }
      const data = new FormData(form);
      done({ name: data.get("name"), order: Number(data.get("order")) || 0, range: data.get("range"), published: form.elements.published.checked, summary: data.get("summary"), important_points: data.get("important_points"), fill_blank, quiz });
    };
    if (dialog) dialog.onclose = () => resolve(null);
  });
}

const context = { loading, toast, show, confirm: confirmDialog, choose: chooseDialog, report: reportDialog, enableAdminNotifications, form: formDialog, unitEditor: (unit, target) => unitEditor(unit, context, target), profile: null, reportCount: 0 };

function updateReportBadge(count) {
  const safe = Math.max(0, Number(count) || 0);
  context.reportCount = safe;
  const badge = $("#adminReportBadge");
  badge.textContent = safe > 99 ? "99+" : String(safe);
  badge.hidden = safe === 0;
  document.querySelectorAll("[data-report-menu-badge]").forEach((item) => {
    item.textContent = safe > 99 ? "99+" : String(safe);
    item.hidden = safe === 0;
  });
}

async function showAdminReportNotification(report) {
  const title = "新しい修正依頼";
  const body = `${report.reporterName || "学生"}：${report.reason || "問題の修正依頼"}`;
  toast(`${title}が届きました。`);
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    const registration = await navigator.serviceWorker?.ready;
    if (registration) await registration.showNotification(title, { body, icon: "assets/cmu-icon.png", badge: "assets/cmu-icon.png", data: { url: `${location.origin}${location.pathname}?page=admin` }, tag: `study-report-${report.id}` });
    else new Notification(title, { body, icon: "assets/cmu-icon.png", tag: `study-report-${report.id}` });
  } catch (_) {}
}

function startAdminReportWatch() {
  stopReportWatch?.();
  stopReportWatch = null;
  knownOpenReportIds = new Set();
  if (profile?.role !== "admin") { updateReportBadge(0); return; }
  let initialized = false;
  stopReportWatch = watchOpenQuestionReports((reports) => {
    updateReportBadge(reports.length);
    if (initialized) reports.filter((report) => !knownOpenReportIds.has(report.id)).forEach(showAdminReportNotification);
    knownOpenReportIds = new Set(reports.map((report) => report.id));
    initialized = true;
  }, (error) => console.warn("修正依頼の通知を更新できませんでした。", error));
}

function setTheme(theme) {
  const dark = theme === "dark";
  document.documentElement.classList.add("theme-changing");
  document.documentElement.classList.toggle("dark", dark);
  localStorage.setItem("caremateTestTheme", dark ? "dark" : "light");
  $("#themeToggle").textContent = dark ? "☀" : "☾";
  $("#themeToggle").setAttribute("aria-label", dark ? "ライトモードへ切り替える" : "ダークモードへ切り替える");
  $("meta[name=theme-color]").content = dark ? "#050505" : "#08aeb8";
  clearTimeout(setTheme.timer);
  setTheme.timer = setTimeout(() => document.documentElement.classList.remove("theme-changing"), 320);
}

async function renderSettings(root) {
  const accountLine = profile.role === "admin" ? profile.studentNumber : `${profile.studentNumber} / ${profile.email}`;
  root.innerHTML = `<section class="hero"><div><span class="chip">アカウント</span><h2>${escapeHtml(profile.name)}</h2><p>${escapeHtml(accountLine)}</p></div><span class="hero-badge">${profile.studentNumber === "2510044" ? "主管理者" : profile.role === "admin" ? "管理者" : "学生"}</span></section><section class="panel"><div class="panel-header"><div><h2>パスワード変更</h2><p>現在のパスワードを確認して変更します。</p></div></div><form id="passwordForm" class="form-stack"><label>現在のパスワード<input name="currentPassword" type="password" autocomplete="current-password" required minlength="8"></label><label>新しいパスワード<input name="nextPassword" type="password" autocomplete="new-password" required minlength="8"></label><label>新しいパスワード（再入力）<input name="confirmPassword" type="password" autocomplete="new-password" required minlength="8"></label><button class="primary-button" type="submit">パスワードを変更</button><p id="passwordStatus" class="status"></p></form></section><section class="panel"><div class="panel-header"><div><h2>ログアウト</h2><p>この端末のログイン状態を終了します。</p></div></div><button id="logoutButton" class="danger-button" type="button">ログアウト</button></section>`;
  $("#passwordForm", root).addEventListener("submit", async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const output = $("#passwordStatus", root); if (form.get("nextPassword") !== form.get("confirmPassword")) { status(output, "新しいパスワードが一致しません。", true); return; } try { loading(true, "パスワードを変更中…"); await changeOwnPassword(form.get("currentPassword"), form.get("nextPassword")); event.currentTarget.reset(); status(output, "パスワードを変更しました。"); } catch (error) { status(output, authErrorMessage(error), true); } finally { loading(false); } });
  $("#logoutButton", root).addEventListener("click", async () => { if (await confirmDialog("ログアウトしますか？")) { loading(true, "ログアウト中…"); await logout(); location.reload(); } });
}

async function navigate(page) {
  if (page === "admin" && profile.role !== "admin") page = "test";
  currentPage = page;
  $("#pageTitle").textContent = page === "test" ? "試験対策" : page === "analytics" ? "学習分析" : page === "settings" ? "設定" : "管理";
  $("#bottomNav").querySelectorAll("[data-page]").forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  loading(true, "画面を読み込み中…");
  try {
    const root = $("#appContent");
    if (page === "test") await renderTestHome(root, context);
    if (page === "analytics") await renderPersonalAnalytics(root, context);
    if (page === "settings") await renderSettings(root);
    if (page === "admin") renderAdmin(root, context);
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) { $("#appContent").innerHTML = `<section class="panel"><div class="empty"><strong>画面を読み込めませんでした</strong><p>${escapeHtml(error.message)}</p><button id="retryPage" class="primary-button">再読み込み</button></div></section>`; $("#retryPage").onclick = () => navigate(currentPage); }
  finally { loading(false); }
}

async function enterApp(foundProfile) {
  profile = foundProfile; context.profile = foundProfile;
  if (profile.active === false) { await logout(); throw new Error("このアカウントは管理者により利用停止されています。"); }
  $("#adminNav").hidden = profile.role !== "admin";
  startAdminReportWatch();
  showOnly("#appShell");
  const requestedPage = new URLSearchParams(location.search).get("page");
  await navigate(requestedPage === "admin" && profile.role === "admin" ? "admin" : "test");
}

async function routeAuthenticatedUser(user) {
  const foundProfile = await getCurrentProfile();
  if (foundProfile) {
    if (foundProfile.role === "admin" || user.emailVerified) { await enterApp(foundProfile); return; }
    $("#verifyEmail").textContent = user.email || ""; showOnly("#verifyScreen"); return;
  }
  const pending = JSON.parse(sessionStorage.getItem("caremateTestPending") || "{}");
  if (pending.mode === "admin") {
    showOnly("#adminPasswordScreen");
    return;
  }
  if (isAdminAuthEmail(user.email)) {
    await discardIncompleteAdminAccount();
    throw new Error("管理者登録が完了していません。発行された登録コードで最初から登録してください。");
  }
  if (!user.emailVerified) {
    $("#verifyEmail").textContent = user.email || ""; showOnly("#verifyScreen"); return;
  }
  $("#activationStudentNumber").value = pending.studentNumber || "";
  showOnly("#activationScreen");
}

function bindEvents() {
  $("#showLogin").onclick = () => { $("#loginForm").hidden = false; $("#registerForm").hidden = true; $("#showLogin").classList.add("active"); $("#showRegister").classList.remove("active"); status($("#authStatus")); };
  $("#showRegister").onclick = () => { $("#loginForm").hidden = true; $("#registerForm").hidden = false; $("#showLogin").classList.remove("active"); $("#showRegister").classList.add("active"); status($("#authStatus")); };
  $("#loginForm").onsubmit = async (event) => { event.preventDefault(); try { loading(true, "ログイン中…"); const user = await loginAccount({ studentNumber: $("#loginStudentNumber").value, password: $("#loginPassword").value }); await routeAuthenticatedUser(user); } catch (error) { status($("#authStatus"), authErrorMessage(error), true); } finally { loading(false); } };
  $("#forgotPassword").onclick = async () => {
    const result = await formDialog("パスワードを忘れた方", [{ name: "studentNumber", label: "学籍番号", value: "", required: true }], "送信");
    if (!result) return;
    try {
      loading(true, "再設定メールを送信中…");
      await requestPasswordReset(result.studentNumber);
      await show(`<h2>メールを確認してください</h2><p>登録されているActive!Mailへ、パスワード再設定用のメールを送信しました。</p><p class="hint">安全のため、登録の有無にかかわらず同じ案内を表示しています。メール内のリンクから新しいパスワードを設定してください。</p>`);
    } catch (error) { status($("#authStatus"), authErrorMessage(error), true); } finally { loading(false); }
  };
  $("#registerForm").onsubmit = async (event) => {
    event.preventDefault();
    const studentNumber = $("#registerStudentNumber").value.trim();
    const emailLocal = $("#registerEmailLocal").value.trim();
    const password = $("#registerPassword").value;
    if (password !== $("#registerPasswordConfirm").value) { status($("#authStatus"), "入力内容が一致しません。", true); return; }
    try {
      if (emailLocal) {
        loading(true, "確認メールを送信中…");
        sessionStorage.setItem("caremateTestPending", JSON.stringify({ mode: "student", studentNumber }));
        const user = await registerStudentAccount({ emailLocal, password });
        await routeAuthenticatedUser(user);
      } else {
        loading(true, "管理者権限を確認中…");
        sessionStorage.setItem("caremateTestPending", JSON.stringify({ mode: "admin", studentNumber, registrationCode: password }));
        const user = await beginAdminRegistration({ studentNumber, registrationCode: password });
        await routeAuthenticatedUser(user);
      }
    } catch (error) {
      sessionStorage.removeItem("caremateTestPending");
      status($("#authStatus"), authErrorMessage(error), true);
    } finally { loading(false); }
  };
  $("#checkVerification").onclick = async () => { try { loading(true, "確認状態を取得中…"); const user = await refreshVerification(); if (!user?.emailVerified) { status($("#verifyStatus"), "まだ確認が完了していません。メール内のリンクを開いてください。", true); return; } await routeAuthenticatedUser(user); } catch (error) { status($("#verifyStatus"), authErrorMessage(error), true); } finally { loading(false); } };
  $("#resendVerification").onclick = async () => { try { await resendVerification(); status($("#verifyStatus"), "確認メールを再送しました。"); } catch (error) { status($("#verifyStatus"), authErrorMessage(error), true); } };
  $("#verifyLogout").onclick = $("#activationLogout").onclick = async () => { sessionStorage.removeItem("caremateTestPending"); await logout(); location.reload(); };
  $("#activationForm").onsubmit = async (event) => { event.preventDefault(); try { loading(true, "利用登録を完了中…"); const found = await completeStudentRegistration($("#activationStudentNumber").value); sessionStorage.removeItem("caremateTestPending"); await enterApp(found); } catch (error) { status($("#activationStatus"), authErrorMessage(error), true); } finally { loading(false); } };
  $("#adminPasswordForm").onsubmit = async (event) => {
    event.preventDefault();
    const nextPassword = $("#adminNewPassword").value;
    if (nextPassword !== $("#adminNewPasswordConfirm").value) { status($("#adminPasswordStatus"), "新しいパスワードが一致しません。", true); return; }
    const pending = JSON.parse(sessionStorage.getItem("caremateTestPending") || "{}");
    try {
      loading(true, "管理者登録を完了中…");
      const found = await finishAdminRegistration({ studentNumber: pending.studentNumber, registrationCode: pending.registrationCode, nextPassword });
      sessionStorage.removeItem("caremateTestPending");
      await enterApp(found);
    } catch (error) { status($("#adminPasswordStatus"), authErrorMessage(error), true); } finally { loading(false); }
  };
  $("#adminRegistrationCancel").onclick = async () => { sessionStorage.removeItem("caremateTestPending"); await discardIncompleteAdminAccount(); location.reload(); };
  $("#bottomNav").querySelectorAll("[data-page]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.page)));
  $("#themeToggle").onclick = () => setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark");
  $("#closeDialog").onclick = closeDialog;
}

async function start() {
  bindEvents();
  setTheme(localStorage.getItem("caremateTestTheme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  loading(true, "利用状態を確認中…");
  try {
    const user = await authReady();
    if (user) await routeAuthenticatedUser(user); else showOnly("#authScreen");
  } catch (error) { await logout().catch(() => {}); showOnly("#authScreen"); status($("#authStatus"), authErrorMessage(error), true); }
  finally { loading(false); }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
}

start();
