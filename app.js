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
  refreshVerification,
  registerStudentAccount,
  resendVerification,
} from "./auth.js";
import { renderTestHome } from "./exam.js";
import { parseUnitJson, renderAdmin } from "./admin.js";

const $ = (selector, root = document) => root.querySelector(selector);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const screens = ["#authScreen", "#verifyScreen", "#activationScreen", "#adminPasswordScreen", "#appShell"];
let profile = null;
let currentPage = "test";
let toastTimer = null;

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
function formDialog(title, fields) {
  return new Promise((resolve) => {
    const inputHtml = fields.map((field) => {
      if (field.type === "checkbox") return `<label class="checkbox-row"><input name="${escapeHtml(field.name)}" type="checkbox" ${field.value ? "checked" : ""}>${escapeHtml(field.label)}</label>`;
      if (field.type === "select") return `<label>${escapeHtml(field.label)}<select name="${escapeHtml(field.name)}">${field.options.map((option) => `<option value="${escapeHtml(option.value)}" ${String(option.value) === String(field.value) ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select></label>`;
      return `<label>${escapeHtml(field.label)}<input name="${escapeHtml(field.name)}" type="${escapeHtml(field.type || "text")}" value="${escapeHtml(field.value || "")}" ${field.required ? "required" : ""}></label>`;
    }).join("");
    const dialog = openDialog(`<form id="modalForm" class="form-stack"><h2>${escapeHtml(title)}</h2>${inputHtml}<div class="inline-actions"><button id="modalCancel" class="secondary-button" type="button">キャンセル</button><button class="primary-button" type="submit">保存</button></div></form>`);
    const done = (value) => { dialog.onclose = null; closeDialog(); resolve(value); };
    $("#modalCancel").onclick = () => done(null);
    $("#modalForm").onsubmit = (event) => { event.preventDefault(); const result = Object.fromEntries(new FormData(event.currentTarget)); fields.filter((field) => field.type === "checkbox").forEach((field) => { result[field.name] = event.currentTarget.elements[field.name].checked; }); done(result); };
    dialog.onclose = () => resolve(null);
  });
}

function unitEditor(unit = {}) {
  return new Promise((resolve) => {
    const fill = JSON.stringify(unit.fill_blank || [], null, 2);
    const quiz = JSON.stringify(unit.quiz || [], null, 2);
    const dialog = openDialog(`<form id="unitEditorForm" class="form-stack admin-editor"><h2>${unit.id ? "単元を編集" : "単元を追加"}</h2><div class="split"><label>単元名<input name="name" value="${escapeHtml(unit.name || "")}" required maxlength="100"></label><label>表示順<input name="order" type="number" value="${Number(unit.order) || 0}"></label></div><label>試験範囲<input name="range" value="${escapeHtml(unit.range || "")}" maxlength="300"></label><label class="checkbox-row"><input name="published" type="checkbox" ${unit.published ? "checked" : ""}>学生に公開する</label><label>要約（1行につき1項目）<textarea name="summary" rows="4">${escapeHtml((unit.summary || []).join("\n"))}</textarea></label><label>重要ポイント（1行につき1項目）<textarea name="important_points" rows="4">${escapeHtml((unit.important_points || []).join("\n"))}</textarea></label><label>穴埋め問題（JSON配列）<textarea name="fill_blank" class="code-area" rows="8">${escapeHtml(fill)}</textarea></label><label>四択問題（JSON配列）<textarea name="quiz" class="code-area" rows="10">${escapeHtml(quiz)}</textarea></label><details><summary>JSON一括読み込み</summary><p class="hint">summary / important_points / fill_blank / quiz を含む既存形式に対応します。</p><textarea id="fullJson" class="code-area" rows="8" placeholder='{"summary":[],"important_points":[],"fill_blank":[],"quiz":[]}'></textarea><button id="applyJson" class="secondary-button" type="button">JSONを入力欄へ反映</button></details><div class="inline-actions"><button id="unitCancel" class="secondary-button" type="button">キャンセル</button><button class="primary-button" type="submit">単元を保存</button></div><p id="unitStatus" class="status"></p></form>`);
    const form = $("#unitEditorForm");
    const done = (value) => { dialog.onclose = null; closeDialog(); resolve(value); };
    $("#unitCancel").onclick = () => done(null);
    $("#applyJson").onclick = () => { try { const parsed = parseUnitJson($("#fullJson").value); form.elements.summary.value = parsed.summary.join("\n"); form.elements.important_points.value = parsed.important_points.join("\n"); form.elements.fill_blank.value = JSON.stringify(parsed.fill_blank, null, 2); form.elements.quiz.value = JSON.stringify(parsed.quiz, null, 2); status($("#unitStatus"), "JSONを反映しました。"); } catch (error) { status($("#unitStatus"), error.message, true); } };
    form.onsubmit = (event) => {
      event.preventDefault();
      try {
        const data = new FormData(form);
        done({ name: data.get("name"), order: Number(data.get("order")) || 0, range: data.get("range"), published: form.elements.published.checked, summary: data.get("summary"), important_points: data.get("important_points"), fill_blank: JSON.parse(data.get("fill_blank") || "[]"), quiz: JSON.parse(data.get("quiz") || "[]") });
      } catch { status($("#unitStatus"), "問題JSONの書式を確認してください。", true); }
    };
    dialog.onclose = () => resolve(null);
  });
}

const context = { loading, toast, show, confirm: confirmDialog, choose: chooseDialog, form: formDialog, unitEditor, profile: null };

function setTheme(theme) {
  const dark = theme === "dark";
  document.documentElement.classList.toggle("dark", dark);
  localStorage.setItem("caremateTestTheme", dark ? "dark" : "light");
  $("#themeToggle").textContent = dark ? "☀" : "☾";
  $("meta[name=theme-color]").content = dark ? "#090909" : "#5b4bdb";
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
  $("#pageTitle").textContent = page === "test" ? "テスト" : page === "settings" ? "設定" : "管理";
  $("#bottomNav").querySelectorAll("[data-page]").forEach((button) => button.classList.toggle("active", button.dataset.page === page));
  loading(true, "画面を読み込み中…");
  try {
    const root = $("#appContent");
    if (page === "test") await renderTestHome(root, context);
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
  showOnly("#appShell");
  await navigate("test");
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
