import { collection, getDocs, orderBy, query } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { db } from "./firebase.js";
import {
  COLLECTIONS,
  cancelInvite,
  createInvite,
  getUnit,
  listCategories,
  listSubjects,
  listUnits,
  listUsersAndInvites,
  normalizeUnitData,
  removeCategory,
  removeSubject,
  removeUnit,
  saveCategory,
  saveSubject,
  saveUnit,
  updateUserAccess,
} from "./store.js";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const dateText = (value) => value?.toDate ? value.toDate().toLocaleString("ja-JP") : "—";

export function renderAdmin(root, context) {
  root.innerHTML = `<section class="hero admin-hero"><div><span class="chip">管理者</span><h2>CareMateUniv 管理</h2><p>利用者の登録と、まっさらなテスト問題の作成・公開を行います。</p></div><span class="hero-badge">ADMIN</span></section><div class="admin-tabs"><button class="active" data-tab="tests">テスト管理</button><button data-tab="users">ユーザー管理</button><button data-tab="reports">修正依頼</button></div><div id="adminBody"></div>`;
  const body = root.querySelector("#adminBody");
  const select = (tab) => {
    root.querySelectorAll("[data-tab]").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
    if (tab === "tests") renderTestManager(body, context);
    if (tab === "users") renderUserManager(body, context);
    if (tab === "reports") renderReports(body);
  };
  root.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => select(button.dataset.tab)));
  select("tests");
}

async function renderUserManager(root, context) {
  root.innerHTML = `<section class="panel"><div class="panel-header"><div><h2>新しい利用者を登録</h2><p>学生はActive!Mail確認後に利用開始します。管理者として招待したアカウントは確認メールを待たずに利用できます。</p></div></div><form id="inviteForm" class="form-stack"><div class="split"><label>学籍番号<input name="studentNumber" inputmode="numeric" pattern="[0-9]{7}" maxlength="7" required></label><label>氏名<input name="name" maxlength="80" required></label></div><div class="split"><label>Active!Mailアドレス<span class="email-field"><input name="emailLocal" maxlength="80" required><b>@sums.ac.jp</b></span></label><label>権限<select name="role"><option value="student">学生</option><option value="admin">管理者</option></select></label></div><button class="primary-button" type="submit">登録コードを発行</button></form></section><section class="panel"><div class="panel-header"><div><h2>ユーザー情報</h2><p>利用停止・再開と権限変更ができます。</p></div></div><div id="userList" class="admin-list"><p class="empty">読み込み中…</p></div></section><section class="panel"><div class="panel-header"><div><h2>未使用の登録コード</h2><p>コードは該当する学生へ安全な方法で渡してください。</p></div></div><div id="inviteList" class="admin-list"></div></section>`;
  root.querySelector("#inviteForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      context.loading(true, "登録コードを発行中…");
      const code = await createInvite(Object.fromEntries(form));
      await context.show(`<h2>登録コード</h2><p>対象学生：${escapeHtml(form.get("studentNumber"))}</p><div class="code-box">${escapeHtml(code)}</div><p class="hint">1回だけ使用できます。Active!Mailアドレスと学籍番号が一致しない場合は登録できません。</p>`);
      event.currentTarget.reset();
      await renderUserManager(root, context);
    } catch (error) { context.toast(error.message, true); } finally { context.loading(false); }
  });
  const data = await listUsersAndInvites();
  const userList = root.querySelector("#userList");
  userList.innerHTML = data.users.length ? data.users.map((user) => `<article class="admin-row"><div><strong>${escapeHtml(user.name || "名前未設定")}（${escapeHtml(user.studentNumber)}）</strong><p>${escapeHtml(user.email)} / ${user.role === "admin" ? "管理者" : "学生"} / ${user.active === false ? "利用停止" : "利用中"}</p></div><div class="inline-actions"><button class="secondary-button" data-role="${escapeHtml(user.id)}" type="button">${user.role === "admin" ? "学生に変更" : "管理者に変更"}</button><button class="${user.active === false ? "primary-button" : "danger-button"}" data-active="${escapeHtml(user.id)}" type="button">${user.active === false ? "利用再開" : "利用停止"}</button></div></article>`).join("") : `<div class="empty">登録済みユーザーはいません。</div>`;
  const inviteList = root.querySelector("#inviteList");
  inviteList.innerHTML = data.invites.length ? data.invites.map((invite) => `<article class="admin-row"><div><strong>${escapeHtml(invite.name)}（${escapeHtml(invite.studentNumber)}）</strong><p>${escapeHtml(invite.email || "初期管理者用")} / ${invite.role === "admin" ? "管理者" : "学生"}</p><div class="code-inline">${escapeHtml(invite.code)}</div></div><button class="danger-button" data-cancel="${escapeHtml(invite.code)}" type="button">無効化</button></article>`).join("") : `<div class="empty">未使用コードはありません。</div>`;
  userList.querySelectorAll("[data-active]").forEach((button) => button.addEventListener("click", async () => {
    const user = data.users.find((item) => item.id === button.dataset.active);
    if (!await context.confirm(`${user.name}を${user.active === false ? "利用再開" : "利用停止"}しますか？`)) return;
    await updateUserAccess(user.id, { active: user.active === false });
    renderUserManager(root, context);
  }));
  userList.querySelectorAll("[data-role]").forEach((button) => button.addEventListener("click", async () => {
    const user = data.users.find((item) => item.id === button.dataset.role);
    const nextRole = user.role === "admin" ? "student" : "admin";
    if (!await context.confirm(`${user.name}の権限を${nextRole === "admin" ? "管理者" : "学生"}へ変更しますか？`)) return;
    await updateUserAccess(user.id, { role: nextRole });
    renderUserManager(root, context);
  }));
  inviteList.querySelectorAll("[data-cancel]").forEach((button) => button.addEventListener("click", async () => {
    if (!await context.confirm("この登録コードを無効化しますか？")) return;
    await cancelInvite(button.dataset.cancel);
    renderUserManager(root, context);
  }));
}

async function renderTestManager(root, context) {
  root.innerHTML = `<section class="panel"><div class="panel-header"><div><h2>テスト管理</h2><p>区分 → 科目 → 単元の順に作成します。初期状態は空です。</p></div><button id="newCategory" class="primary-button" type="button">区分を追加</button></div><div id="categoryList" class="admin-list"><p class="empty">読み込み中…</p></div></section><section class="panel"><div class="panel-header"><div><h2>科目</h2><p>公開した科目だけ学生画面に表示されます。</p></div><button id="newSubject" class="primary-button" type="button">科目を追加</button></div><div id="subjectList" class="admin-list"></div></section><section id="unitPanel" class="panel" hidden><div class="panel-header"><div><h2 id="unitPanelTitle">単元</h2><p>要約・重要ポイント・穴埋め・四択を登録できます。</p></div><button id="newUnit" class="primary-button" type="button">単元を追加</button></div><div id="unitList" class="admin-list"></div></section>`;
  const [categories, subjects] = await Promise.all([listCategories(), listSubjects()]);
  const categoryMap = new Map(categories.map((item) => [item.id, item.name]));
  const categoryList = root.querySelector("#categoryList");
  categoryList.innerHTML = categories.length ? categories.map((category) => `<article class="admin-row"><div><strong>${escapeHtml(category.name)}</strong><p>表示順 ${Number(category.order) || 0}</p></div><div class="inline-actions"><button class="secondary-button" data-edit-category="${category.id}">編集</button><button class="danger-button" data-delete-category="${category.id}">削除</button></div></article>`).join("") : `<div class="empty">区分はまだありません。「区分を追加」から始めてください。</div>`;
  const subjectList = root.querySelector("#subjectList");
  subjectList.innerHTML = subjects.length ? subjects.map((subject) => `<article class="admin-row"><div><strong>${escapeHtml(subject.name)}</strong><p>${escapeHtml(categoryMap.get(subject.categoryId) || "区分不明")} / ${subject.published ? "公開中" : "非公開"}</p></div><div class="inline-actions"><button class="primary-button" data-units="${subject.id}">単元</button><button class="secondary-button" data-edit-subject="${subject.id}">編集</button><button class="danger-button" data-delete-subject="${subject.id}">削除</button></div></article>`).join("") : `<div class="empty">科目はまだありません。</div>`;

  const categoryForm = async (category = {}) => {
    const result = await context.form("区分", [{ name: "name", label: "区分名", value: category.name || "", required: true }, { name: "order", label: "表示順", type: "number", value: category.order || 0 }]);
    if (!result) return; await saveCategory({ id: category.id, ...result }); renderTestManager(root, context);
  };
  root.querySelector("#newCategory").addEventListener("click", () => categoryForm());
  categoryList.querySelectorAll("[data-edit-category]").forEach((button) => button.addEventListener("click", () => categoryForm(categories.find((item) => item.id === button.dataset.editCategory))));
  categoryList.querySelectorAll("[data-delete-category]").forEach((button) => button.addEventListener("click", async () => { if (await context.confirm("この区分を削除しますか？科目は自動削除されません。")) { await removeCategory(button.dataset.deleteCategory); renderTestManager(root, context); } }));

  const subjectForm = async (subject = {}) => {
    if (!categories.length) { context.toast("先に区分を作成してください。", true); return; }
    const result = await context.form("科目", [{ name: "name", label: "科目名", value: subject.name || "", required: true }, { name: "categoryId", label: "区分", type: "select", value: subject.categoryId || categories[0].id, options: categories.map((item) => ({ value: item.id, label: item.name })) }, { name: "order", label: "表示順", type: "number", value: subject.order || 0 }, { name: "published", label: "学生に公開", type: "checkbox", value: subject.published === true }]);
    if (!result) return; await saveSubject({ id: subject.id, ...result }); renderTestManager(root, context);
  };
  root.querySelector("#newSubject").addEventListener("click", () => subjectForm());
  subjectList.querySelectorAll("[data-edit-subject]").forEach((button) => button.addEventListener("click", () => subjectForm(subjects.find((item) => item.id === button.dataset.editSubject))));
  subjectList.querySelectorAll("[data-delete-subject]").forEach((button) => button.addEventListener("click", async () => { if (await context.confirm("この科目を削除しますか？配下の単元も見えなくなります。")) { await removeSubject(button.dataset.deleteSubject); renderTestManager(root, context); } }));
  subjectList.querySelectorAll("[data-units]").forEach((button) => button.addEventListener("click", () => renderUnitManager(root, context, subjects.find((item) => item.id === button.dataset.units))));
}

async function renderUnitManager(root, context, subject) {
  const panel = root.querySelector("#unitPanel");
  panel.hidden = false;
  panel.scrollIntoView({ behavior: "smooth", block: "start" });
  root.querySelector("#unitPanelTitle").textContent = `${subject.name} の単元`;
  const units = await listUnits(subject.id);
  const list = root.querySelector("#unitList");
  list.innerHTML = units.length ? units.map((unit) => `<article class="admin-row"><div><strong>${escapeHtml(unit.name)}</strong><p>${unit.published ? "公開中" : "非公開"} / 穴埋め ${(unit.fill_blank || []).length}問 / 四択 ${(unit.quiz || []).length}問</p></div><div class="inline-actions"><button class="secondary-button" data-edit-unit="${unit.id}">編集</button><button class="danger-button" data-delete-unit="${unit.id}">削除</button></div></article>`).join("") : `<div class="empty">単元はまだありません。</div>`;
  const edit = async (unit = {}) => {
    const fresh = unit.id ? await getUnit(subject.id, unit.id) : {};
    const result = await context.unitEditor(fresh);
    if (!result) return;
    await saveUnit(subject.id, { id: fresh.id, ...result });
    context.toast("単元を保存しました。");
    renderUnitManager(root, context, subject);
  };
  const newButton = root.querySelector("#newUnit");
  newButton.onclick = () => edit();
  list.querySelectorAll("[data-edit-unit]").forEach((button) => button.addEventListener("click", () => edit(units.find((item) => item.id === button.dataset.editUnit))));
  list.querySelectorAll("[data-delete-unit]").forEach((button) => button.addEventListener("click", async () => { if (await context.confirm("この単元を削除しますか？")) { await removeUnit(subject.id, button.dataset.deleteUnit); renderUnitManager(root, context, subject); } }));
}

async function renderReports(root) {
  root.innerHTML = `<section class="panel"><div class="panel-header"><div><h2>問題の修正依頼</h2><p>学生が「違います」から送信した内容です。</p></div></div><div id="reportList" class="admin-list"><p class="empty">読み込み中…</p></div></section>`;
  const snapshot = await getDocs(query(collection(db, COLLECTIONS.reports), orderBy("createdAt", "desc")));
  const reports = snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
  root.querySelector("#reportList").innerHTML = reports.length ? reports.map((item) => `<article class="admin-row"><div><strong>${escapeHtml(item.reason)}</strong><p>${escapeHtml(item.question)}</p><p>${dateText(item.createdAt)} / ${escapeHtml(item.type)} ${Number(item.index) + 1}</p></div><span class="chip">${escapeHtml(item.status || "open")}</span></article>`).join("") : `<div class="empty">修正依頼はありません。</div>`;
}

export function parseUnitJson(text) {
  const value = JSON.parse(text);
  const source = Array.isArray(value) ? value[0] : value;
  if (!source || typeof source !== "object") throw new Error("JSONの内容を確認してください。");
  return normalizeUnitData(source);
}
