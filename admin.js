import { collection, getDocs, orderBy, query } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";
import { db } from "./firebase.js";
import {
  COLLECTIONS,
  cancelInvite,
  createAdminInvite,
  deleteStudyUser,
  getUnit,
  listAllProgress,
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
  const primary = context.profile?.studentNumber === "2510044";
  root.innerHTML = `<section class="hero admin-hero"><div><span class="chip">${primary ? "主管理者" : "管理者"}</span><h2>CareMateUniv 管理</h2><p>管理者の登録、利用者管理、テスト問題の作成・公開を行います。</p></div><span class="hero-badge">${primary ? "OWNER" : "ADMIN"}</span></section><div class="admin-tabs"><button class="active" data-tab="tests">テスト管理</button><button data-tab="analytics">学習分析</button><button data-tab="users">ユーザー管理</button><button data-tab="reports">修正依頼</button></div><div id="adminBody"></div>`;
  const body = root.querySelector("#adminBody");
  const select = (tab) => {
    root.querySelectorAll("[data-tab]").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
    if (tab === "tests") renderTestManager(body, context);
    if (tab === "analytics") renderAnalytics(body, context);
    if (tab === "users") renderUserManager(body, context);
    if (tab === "reports") renderReports(body);
  };
  root.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => select(button.dataset.tab)));
  select("tests");
}

async function renderUserManager(root, context) {
  const isPrimaryAdmin = context.profile?.studentNumber === "2510044";
  root.innerHTML = `<section class="panel"><div class="panel-header"><div><h2>新しい管理者を登録</h2><p>対象者の学籍番号と氏名だけを登録します。発行コードは一度だけ使用できます。</p></div></div><form id="inviteForm" class="form-stack"><div class="split"><label>学籍番号<input name="studentNumber" inputmode="numeric" pattern="[0-9]{7}" maxlength="7" required></label><label>氏名<input name="name" maxlength="80" required></label></div><button class="primary-button" type="submit">管理者登録コードを発行</button></form></section><section class="panel"><div class="panel-header"><div><h2>ユーザー情報</h2><p>${isPrimaryAdmin ? "主管理者は利用者を削除できます。2510044の権限は固定です。" : "利用停止・再開はできます。削除は主管理者のみ可能です。"}</p></div></div><div id="userList" class="admin-list"><p class="empty">読み込み中…</p></div></section><section class="panel"><div class="panel-header"><div><h2>未使用の管理者登録コード</h2><p>コードは対象者へ安全な方法で渡してください。</p></div></div><div id="inviteList" class="admin-list"></div></section>`;
  root.querySelector("#inviteForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      context.loading(true, "登録コードを発行中…");
      const code = await createAdminInvite(Object.fromEntries(form));
      await context.show(`<h2>管理者登録コード</h2><p>対象者：${escapeHtml(form.get("studentNumber"))}</p><div class="code-box">${escapeHtml(code)}</div><p class="hint">1回だけ使用できます。新規登録画面ではメールアドレスを空欄にし、このコードをパスワード欄と再入力欄へ入力します。</p>`);
      event.currentTarget.reset();
      await renderUserManager(root, context);
    } catch (error) { context.toast(error.message, true); } finally { context.loading(false); }
  });
  const data = await listUsersAndInvites();
  const userList = root.querySelector("#userList");
  userList.innerHTML = data.users.length ? data.users.map((user) => {
    const isPrimary = user.studentNumber === "2510044";
    const identity = user.role === "admin" ? (isPrimary ? "主管理者" : "管理者") : `学生${user.email ? ` / ${escapeHtml(user.email)}` : ""}`;
    const actions = isPrimary
      ? `<span class="chip">権限固定</span>`
      : `<div class="inline-actions"><button class="${user.active === false ? "primary-button" : "secondary-button"}" data-active="${escapeHtml(user.id)}" type="button">${user.active === false ? "利用再開" : "利用停止"}</button>${isPrimaryAdmin ? `<button class="danger-button" data-delete-user="${escapeHtml(user.id)}" type="button">登録削除</button>` : ""}</div>`;
    return `<article class="admin-row"><div><strong>${escapeHtml(user.name || "名前未設定")}（${escapeHtml(user.studentNumber)}）</strong><p>${identity} / ${user.active === false ? "利用停止" : "利用中"}</p></div>${actions}</article>`;
  }).join("") : `<div class="empty">登録済みユーザーはいません。</div>`;
  const inviteList = root.querySelector("#inviteList");
  inviteList.innerHTML = data.invites.length ? data.invites.map((invite) => `<article class="admin-row"><div><strong>${escapeHtml(invite.name)}（${escapeHtml(invite.studentNumber)}）</strong><p>${invite.role === "admin" ? "管理者" : "旧形式の学生登録"}</p><div class="code-inline">${escapeHtml(invite.code)}</div></div><button class="danger-button" data-cancel="${escapeHtml(invite.code)}" type="button">無効化</button></article>`).join("") : `<div class="empty">未使用コードはありません。</div>`;
  userList.querySelectorAll("[data-active]").forEach((button) => button.addEventListener("click", async () => {
    const user = data.users.find((item) => item.id === button.dataset.active);
    if (!await context.confirm(`${user.name}を${user.active === false ? "利用再開" : "利用停止"}しますか？`)) return;
    await updateUserAccess(user.id, { active: user.active === false });
    renderUserManager(root, context);
  }));
  userList.querySelectorAll("[data-delete-user]").forEach((button) => button.addEventListener("click", async () => {
    const user = data.users.find((item) => item.id === button.dataset.deleteUser);
    if (!await context.confirm(`${user.name}（${user.studentNumber}）の登録と学習履歴を削除しますか？この操作は元に戻せません。`)) return;
    try {
      context.loading(true, "登録情報を削除中…");
      await deleteStudyUser(user.id, user.studentNumber);
      context.toast("登録情報を削除しました。");
      await renderUserManager(root, context);
    } catch (error) { context.toast(error.message, true); } finally { context.loading(false); }
  }));
  inviteList.querySelectorAll("[data-cancel]").forEach((button) => button.addEventListener("click", async () => {
    if (!await context.confirm("この登録コードを無効化しますか？")) return;
    await cancelInvite(button.dataset.cancel);
    renderUserManager(root, context);
  }));
}

async function renderAnalytics(root, context) {
  root.innerHTML = `<section class="panel"><div class="panel-header"><div><h2>学生全体の学習分析</h2><p>問題ごとの正答率、解答回数、苦手傾向を確認できます。</p></div><span class="chip">集計中</span></div><div class="empty">学習結果を読み込んでいます…</div></section>`;
  try {
    const [subjects, allProgress, directory] = await Promise.all([listSubjects(), listAllProgress(), listUsersAndInvites()]);
    const registeredUids = new Set(directory.users.map((item) => item.id));
    const progress = allProgress.filter((item) => registeredUids.has(item.uid));
    const unitsBySubject = new Map();
    await Promise.all(subjects.map(async (subject) => {
      unitsBySubject.set(subject.id, await listUnits(subject.id));
    }));
    const subjectMap = new Map(subjects.map((item) => [item.id, item]));
    const unitMap = new Map();
    unitsBySubject.forEach((units, subjectId) => units.forEach((unit) => unitMap.set(`${subjectId}/${unit.id}`, unit)));

    const users = new Set();
    const questions = new Map();
    let totalAttempts = 0;
    let totalCorrect = 0;
    let legacySessions = 0;
    progress.forEach((entry) => {
      if (entry.uid) users.add(entry.uid);
      const stats = entry.questionStats && typeof entry.questionStats === "object" ? entry.questionStats : {};
      if (!Object.keys(stats).length && Number(entry.answered || 0) > 0) legacySessions += 1;
      Object.entries(stats).forEach(([questionKey, value]) => {
        const attempts = Math.max(0, Number(value?.attempts || 0));
        const correct = Math.min(attempts, Math.max(0, Number(value?.correct || 0)));
        if (!attempts) return;
        const key = `${entry.subjectId}/${entry.unitId}/${questionKey}`;
        const aggregate = questions.get(key) || { subjectId: entry.subjectId, unitId: entry.unitId, questionKey, attempts: 0, correct: 0 };
        aggregate.attempts += attempts;
        aggregate.correct += correct;
        questions.set(key, aggregate);
        totalAttempts += attempts;
        totalCorrect += correct;
      });
    });

    const rows = [...questions.values()].map((item) => {
      const unit = unitMap.get(`${item.subjectId}/${item.unitId}`) || {};
      const [type, rawIndex] = item.questionKey.split(":");
      const source = type === "quiz" ? unit.quiz : unit.fill_blank;
      const question = Array.isArray(source) ? source[Number(rawIndex)]?.question : "";
      return {
        ...item,
        subject: subjectMap.get(item.subjectId)?.name || "削除済み科目",
        unit: unit.name || "削除済み単元",
        question: question || `問題 ${Number(rawIndex) + 1}`,
        rate: item.attempts ? Math.round((item.correct / item.attempts) * 100) : 0,
      };
    }).sort((a, b) => a.rate - b.rate || b.attempts - a.attempts);
    const overall = totalAttempts ? Math.round((totalCorrect / totalAttempts) * 100) : 0;
    const fillRows = rows.filter((item) => item.questionKey.startsWith("fill_blank:"));
    const quizRows = rows.filter((item) => item.questionKey.startsWith("quiz:"));
    const typeRate = (items) => {
      const attempts = items.reduce((sum, item) => sum + item.attempts, 0);
      const correct = items.reduce((sum, item) => sum + item.correct, 0);
      return attempts ? Math.round((correct / attempts) * 100) : 0;
    };
    const rowHtml = rows.map((item) => `<article class="analytics-row"><div class="analytics-copy"><span>${escapeHtml(item.subject)} / ${escapeHtml(item.unit)}</span><strong>${escapeHtml(item.question)}</strong><small>${item.correct} / ${item.attempts}回正解</small></div><div class="analytics-rate"><b>${item.rate}%</b><span><i style="width:${item.rate}%"></i></span></div></article>`).join("");
    root.innerHTML = `<section class="analytics-summary"><article><span>参加学生</span><strong>${users.size}</strong><small>人</small></article><article><span>全体正答率</span><strong>${overall}</strong><small>%</small></article><article><span>総解答数</span><strong>${totalAttempts}</strong><small>回</small></article><article><span>要復習</span><strong>${rows.filter((item) => item.rate < 60).length}</strong><small>問</small></article></section><section class="panel"><div class="panel-header"><div><h2>形式別の正答率</h2><p>穴埋めと四択の理解度を比較します。</p></div></div><div class="type-chart"><div><b>穴埋め</b><span><i style="width:${typeRate(fillRows)}%"></i></span><strong>${typeRate(fillRows)}%</strong></div><div><b>四択</b><span><i style="width:${typeRate(quizRows)}%"></i></span><strong>${typeRate(quizRows)}%</strong></div></div></section><section class="panel"><div class="panel-header"><div><h2>問題ごとの正答率</h2><p>正答率の低い問題から表示しています。</p></div><span class="chip">${rows.length}問</span></div>${rowHtml || `<div class="empty"><strong>問題別データはまだありません</strong><p>学生が次に問題へ解答すると自動集計されます。</p></div>`}${legacySessions ? `<p class="hint">旧形式の学習記録 ${legacySessions}件は、問題単位の内訳がないため全体集計に含めていません。</p>` : ""}</section>`;
  } catch (error) {
    root.innerHTML = `<section class="panel"><div class="empty"><strong>分析データを読み込めませんでした</strong><p>${escapeHtml(error.message)}</p><button id="retryAnalytics" class="primary-button" type="button">再読み込み</button></div></section>`;
    root.querySelector("#retryAnalytics")?.addEventListener("click", () => renderAnalytics(root, context));
  }
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
