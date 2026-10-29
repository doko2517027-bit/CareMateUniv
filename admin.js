import { auth } from "./firebase.js";
import {
  cancelInvite,
  createAdminInvite,
  deleteStudyUser,
  getUnit,
  listProgress,
  listCategories,
  listQuestionReports,
  listSubjects,
  listUnits,
  listUsersAndInvites,
  normalizeUnitData,
  removeCategory,
  removeSubject,
  removeUnit,
  resetStudyUserPassword,
  saveCategory,
  saveSubject,
  saveUnit,
  updateUserAccess,
  updateQuestionReportStatus,
} from "./store.js";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const dateText = (value) => value?.toDate ? value.toDate().toLocaleString("ja-JP") : "—";

export function renderAdmin(root, context) {
  renderAdminMenu(root, context);
}

function adminHeader(title, description, onBack) {
  return `<div class="study-header"><button class="back-button" data-admin-back type="button" aria-label="管理メニューへ戻る">‹</button><div><span class="brand-mini">ADMIN</span><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div></div>`;
}

function bindAdminBack(root, callback) {
  root.querySelector("[data-admin-back]")?.addEventListener("click", callback);
}

function renderAdminMenu(root, context) {
  const primary = context.profile?.studentNumber === "2510044";
  const notificationAvailable = "Notification" in window;
  const notificationGranted = notificationAvailable && Notification.permission === "granted";
  root.innerHTML = `<section class="hero admin-hero"><div><span class="chip">${primary ? "主管理者" : "管理者"}</span><h2>管理メニュー</h2><p>行う作業を選んで専用画面へ移動します。</p></div><span class="hero-badge">${primary ? "OWNER" : "ADMIN"}</span></section>${notificationGranted ? "" : `<section class="admin-notification-banner"><div><strong>修正依頼の通知</strong><p>${notificationAvailable ? "通知を許可すると、新しい修正依頼をすぐ確認できます。" : "このブラウザは通知に対応していません。"}</p></div>${notificationAvailable ? `<button id="enableAdminNotifications" class="primary-button" type="button">通知を有効にする</button>` : ""}</section>`}<section class="admin-menu-grid"><button data-admin-page="tests" type="button"><span>📚</span><strong>テスト管理</strong><small>区分・科目・単元・問題</small><i>›</i></button><button data-admin-page="analytics" type="button"><span>📊</span><strong>全体の学習分析</strong><small>正答率・苦手問題・解答数</small><i>›</i></button><button data-admin-page="users" type="button"><span>👥</span><strong>ユーザー管理</strong><small>管理者と学生を分けて管理</small><i>›</i></button><button class="report-menu-button" data-admin-page="reports" type="button"><span>✎</span><span class="report-menu-copy"><strong>修正依頼</strong><small>問題・答え・解説の報告</small></span><em data-report-menu-badge class="notification-count-badge" ${context.reportCount ? "" : "hidden"}>${context.reportCount || 0}</em><i>›</i></button></section>`;
  root.querySelector('[data-admin-page="tests"]').onclick = () => renderTestManager(root, context);
  root.querySelector('[data-admin-page="analytics"]').onclick = () => renderAnalytics(root, context, { back: () => renderAdminMenu(root, context) });
  root.querySelector('[data-admin-page="users"]').onclick = () => renderUserManager(root, context);
  root.querySelector('[data-admin-page="reports"]').onclick = () => renderReports(root, context);
  root.querySelector("#enableAdminNotifications")?.addEventListener("click", async () => { await context.enableAdminNotifications(); renderAdminMenu(root, context); });
}

async function renderUserManager(root, context) {
  const isPrimaryAdmin = context.profile?.studentNumber === "2510044";
  root.innerHTML = `${adminHeader("ユーザー管理", "管理者と学生を分けて表示", () => renderAdminMenu(root, context))}<section class="panel"><div class="panel-header"><div><h2>新しい管理者を登録</h2><p>対象者の学籍番号と氏名だけを登録します。発行コードは一度だけ使用できます。</p></div></div><form id="inviteForm" class="form-stack"><div class="split"><label>学籍番号<input name="studentNumber" inputmode="numeric" pattern="[0-9]{7}" maxlength="7" required></label><label>氏名<input name="name" maxlength="80" required></label></div><button class="primary-button" type="submit">管理者登録コードを発行</button></form></section><section class="panel user-group-panel"><div class="panel-header"><div><h2>管理者一覧</h2><p>主管理者2510044の権限は固定されています。</p></div><span id="adminCount" class="chip">—</span></div><div id="adminUserList" class="admin-list"><p class="empty">読み込み中…</p></div></section><section class="panel user-group-panel"><div class="panel-header"><div><h2>学生一覧</h2><p>${isPrimaryAdmin ? "主管理者は学生の登録削除もできます。" : "利用停止・再開と仮パスワード設定ができます。"}</p></div><span id="studentCount" class="chip">—</span></div><div id="studentUserList" class="admin-list"><p class="empty">読み込み中…</p></div></section><section class="panel"><div class="panel-header"><div><h2>未使用の管理者登録コード</h2><p>コードは対象者へ安全な方法で渡してください。</p></div></div><div id="inviteList" class="admin-list"></div></section>`;
  bindAdminBack(root, () => renderAdminMenu(root, context));
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
  const userRow = (user) => {
    const isPrimary = user.studentNumber === "2510044";
    const identity = user.role === "admin" ? (isPrimary ? "主管理者" : "管理者") : `学生${user.email ? ` / ${escapeHtml(user.email)}` : ""}`;
    const canReset = isPrimary ? isPrimaryAdmin : user.role !== "admin" || isPrimaryAdmin || user.id === auth.currentUser?.uid;
    return `<article class="admin-row user-account-row"><div><strong>${escapeHtml(user.name || "名前未設定")}（${escapeHtml(user.studentNumber)}）</strong><p>${identity} / ${user.active === false ? "利用停止" : "利用中"}</p></div><div class="inline-actions">${canReset ? `<button class="secondary-button" data-reset-user="${escapeHtml(user.id)}" type="button">仮パスワード設定</button>` : ""}${isPrimary ? `<span class="chip">権限固定</span>` : `<button class="${user.active === false ? "primary-button" : "secondary-button"}" data-active="${escapeHtml(user.id)}" type="button">${user.active === false ? "利用再開" : "利用停止"}</button>${isPrimaryAdmin ? `<button class="danger-button" data-delete-user="${escapeHtml(user.id)}" type="button">登録削除</button>` : ""}`}</div></article>`;
  };
  const administrators = data.users.filter((user) => user.role === "admin");
  const students = data.users.filter((user) => user.role !== "admin");
  root.querySelector("#adminCount").textContent = `${administrators.length}人`;
  root.querySelector("#studentCount").textContent = `${students.length}人`;
  root.querySelector("#adminUserList").innerHTML = administrators.length ? administrators.map(userRow).join("") : `<div class="empty">管理者はいません。</div>`;
  root.querySelector("#studentUserList").innerHTML = students.length ? students.map(userRow).join("") : `<div class="empty">学生はいません。</div>`;
  const inviteList = root.querySelector("#inviteList");
  inviteList.innerHTML = data.invites.length ? data.invites.map((invite) => `<article class="admin-row"><div><strong>${escapeHtml(invite.name)}（${escapeHtml(invite.studentNumber)}）</strong><p>${invite.role === "admin" ? "管理者" : "旧形式の学生登録"}</p><div class="code-inline">${escapeHtml(invite.code)}</div></div><button class="danger-button" data-cancel="${escapeHtml(invite.code)}" type="button">無効化</button></article>`).join("") : `<div class="empty">未使用コードはありません。</div>`;
  root.querySelectorAll("[data-active]").forEach((button) => button.addEventListener("click", async () => {
    const user = data.users.find((item) => item.id === button.dataset.active);
    if (!await context.confirm(`${user.name}を${user.active === false ? "利用再開" : "利用停止"}しますか？`)) return;
    await updateUserAccess(user.id, { active: user.active === false });
    renderUserManager(root, context);
  }));
  root.querySelectorAll("[data-delete-user]").forEach((button) => button.addEventListener("click", async () => {
    const user = data.users.find((item) => item.id === button.dataset.deleteUser);
    if (!await context.confirm(`${user.name}（${user.studentNumber}）の登録と学習履歴を削除しますか？この操作は元に戻せません。`)) return;
    try {
      context.loading(true, "登録情報を削除中…");
      await deleteStudyUser(user.id, user.studentNumber);
      context.toast("登録情報を削除しました。");
      await renderUserManager(root, context);
    } catch (error) { context.toast(error.message, true); } finally { context.loading(false); }
  }));
  root.querySelectorAll("[data-reset-user]").forEach((button) => button.addEventListener("click", async () => {
    const user = data.users.find((item) => item.id === button.dataset.resetUser);
    const result = await context.form(`${user.studentNumber} の仮パスワード`, [{ name: "nextPassword", label: "仮パスワード（8文字以上）", type: "password", required: true }, { name: "confirmPassword", label: "仮パスワード再入力", type: "password", required: true }]);
    if (!result) return;
    if (result.nextPassword !== result.confirmPassword || result.nextPassword.length < 8) { context.toast("8文字以上の同じパスワードを入力してください。", true); return; }
    try {
      context.loading(true, "パスワードを変更中…");
      await resetStudyUserPassword(user.id, result.nextPassword);
      await context.show(`<h2>仮パスワードを設定しました</h2><p>${escapeHtml(user.studentNumber)}へ安全な方法で伝えてください。</p><p class="hint">ログイン後、設定画面からすぐに本人用パスワードへ変更するよう伝えてください。</p>`);
    } catch (error) { context.toast(error.message, true); } finally { context.loading(false); }
  }));
  inviteList.querySelectorAll("[data-cancel]").forEach((button) => button.addEventListener("click", async () => {
    if (!await context.confirm("この登録コードを無効化しますか？")) return;
    await cancelInvite(button.dataset.cancel);
    renderUserManager(root, context);
  }));
}

export async function renderPersonalAnalytics(root, context) {
  return renderAnalytics(root, context, { uid: auth.currentUser?.uid || "" });
}

async function renderAnalytics(root, context, options = {}) {
  const personal = Boolean(options.uid);
  root.innerHTML = `${options.back ? adminHeader("全体の学習分析", "学生全体の正答率と苦手傾向", options.back) : ""}<section class="panel"><div class="panel-header"><div><h2>${personal ? "自分の学習分析" : "学生全体の学習分析"}</h2><p>問題ごとの正答率、解答回数、苦手傾向を確認できます。</p></div><span class="chip">集計中</span></div><div class="empty">学習結果を読み込んでいます…</div></section>`;
  if (options.back) bindAdminBack(root, options.back);
  try {
    const [subjects, directory] = await Promise.all([listSubjects({ publishedOnly: personal }), personal ? Promise.resolve(null) : listUsersAndInvites()]);
    const progress = personal
      ? await listProgress(options.uid)
      : (await Promise.all(directory.users.map((user) => listProgress(user.id)))).flat();
    const unitsBySubject = new Map();
    await Promise.all(subjects.map(async (subject) => {
      unitsBySubject.set(subject.id, await listUnits(subject.id, { publishedOnly: personal }));
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
    const aggregate = (items) => {
      const attempts = items.reduce((sum, item) => sum + item.attempts, 0);
      const correct = items.reduce((sum, item) => sum + item.correct, 0);
      return { attempts, correct, rate: attempts ? Math.round((correct / attempts) * 100) : 0 };
    };
    const ring = (value, label) => `<span class="progress-ring analytics-progress-ring" style="--progress:${value}" role="img" aria-label="${escapeHtml(label)} ${value}%"><span><b>${value}</b><small>%</small></span></span>`;
    const subjectSummaries = subjects.map((subject) => {
      const relatedRows = rows.filter((item) => item.subjectId === subject.id);
      const result = aggregate(relatedRows);
      const entries = progress.filter((entry) => entry.subjectId === subject.id);
      const units = unitsBySubject.get(subject.id) || [];
      const total = units.reduce((sum, unit) => sum + Math.max((unit.fill_blank || []).length + (unit.quiz || []).length, Number(entries.find((entry) => entry.unitId === unit.id)?.total || 0)), 0);
      const answered = units.reduce((sum, unit) => {
        const entry = entries.find((item) => item.unitId === unit.id) || {};
        const unitTotal = Math.max((unit.fill_blank || []).length + (unit.quiz || []).length, Number(entry.total || 0));
        return sum + Math.min(unitTotal, Math.max(Number(entry.answered || 0), Object.keys(entry.questionStats || {}).length));
      }, 0);
      return { ...result, subject, answered, total, progressRate: total ? Math.min(100, Math.round((answered / total) * 100)) : 0 };
    });
    const unitSummaries = subjects.flatMap((subject) => (unitsBySubject.get(subject.id) || []).map((unit) => {
      const relatedRows = rows.filter((item) => item.subjectId === subject.id && item.unitId === unit.id);
      const result = aggregate(relatedRows);
      const entry = progress.find((item) => item.subjectId === subject.id && item.unitId === unit.id) || {};
      const total = Math.max((unit.fill_blank || []).length + (unit.quiz || []).length, Number(entry.total || 0));
      const answered = Math.min(total, Math.max(Number(entry.answered || 0), Object.keys(entry.questionStats || {}).length));
      return { ...result, subject, unit, answered, total, progressRate: total ? Math.min(100, Math.round((answered / total) * 100)) : 0 };
    }));
    const summaryHtml = `<section class="analytics-summary"><article><span>${personal ? "解答単元" : "参加学生"}</span><strong>${personal ? progress.filter((entry) => Number(entry.answered || 0) > 0 || Object.keys(entry.questionStats || {}).length).length : users.size}</strong><small>${personal ? "単元" : "人"}</small></article><article><span>${personal ? "正答率" : "全体正答率"}</span><strong>${overall}</strong><small>%</small></article><article><span>総解答数</span><strong>${totalAttempts}</strong><small>回</small></article><article><span>要復習</span><strong>${rows.filter((item) => item.rate < 60).length}</strong><small>問</small></article></section>`;
    const overallHtml = `${summaryHtml}<section class="panel"><div class="panel-header"><div><h2>形式別の正答率</h2><p>穴埋めと選択問題の理解度を比較します。</p></div></div><div class="type-chart"><div><b>穴埋め</b><span><i style="width:${typeRate(fillRows)}%"></i></span><strong>${typeRate(fillRows)}%</strong></div><div><b>選択問題</b><span><i style="width:${typeRate(quizRows)}%"></i></span><strong>${typeRate(quizRows)}%</strong></div></div></section><section class="panel"><div class="panel-header"><div><h2>問題ごとの正答率</h2><p>正答率の低い問題から表示しています。</p></div><span class="chip">${rows.length}問</span></div>${rowHtml || `<div class="empty"><strong>問題別データはまだありません</strong><p>問題へ解答すると自動集計されます。</p></div>`}${legacySessions ? `<p class="hint">旧形式の学習記録 ${legacySessions}件は、問題単位の内訳がないため全体集計に含めていません。</p>` : ""}</section>`;
    const subjectHtml = `<section class="panel"><div class="panel-header"><div><h2>科目ごとの分析</h2><p>解答進捗と正答率を科目単位で比較します。</p></div></div><div class="analysis-card-grid">${subjectSummaries.map((item) => `<article class="analysis-progress-card"><div class="analysis-progress-heading"><div><strong>${escapeHtml(item.subject.name)}</strong><small>${item.attempts}回解答・${item.correct}回正解</small></div>${ring(item.rate, `${item.subject.name} 正答率`)}</div><div class="analysis-metric"><span>解答進捗</span><b>${item.progressRate}%</b></div><span class="mini-progress"><i style="width:${item.progressRate}%"></i></span><p>${item.answered} / ${item.total}問を解答</p></article>`).join("") || `<div class="empty">科目がまだありません。</div>`}</div></section>`;
    const unitHtml = `<section class="panel"><div class="panel-header"><div><h2>単元ごとの分析</h2><p>単元ごとの理解度と残り問題を確認します。</p></div></div><div class="analysis-unit-list">${unitSummaries.map((item) => `<article class="analysis-unit-row"><div class="analytics-copy"><span>${escapeHtml(item.subject.name)}</span><strong>${escapeHtml(item.unit.name)}</strong><small>${item.correct} / ${item.attempts}回正解・${item.answered} / ${item.total}問解答</small></div>${ring(item.rate, `${item.unit.name} 正答率`)}<div class="analysis-unit-bars"><div><span>解答進捗</span><b>${item.progressRate}%</b></div><span class="mini-progress"><i style="width:${item.progressRate}%"></i></span><div><span>正答率</span><b>${item.rate}%</b></div><span class="mini-progress accuracy"><i style="width:${item.rate}%"></i></span></div></article>`).join("") || `<div class="empty">単元がまだありません。</div>`}</div></section>`;
    const switchHtml = personal ? `<div class="analysis-view-switch" role="tablist" aria-label="分析表示"><button class="active" data-analysis-view="overall" type="button">全体</button><button data-analysis-view="subjects" type="button">科目ごと</button><button data-analysis-view="units" type="button">単元ごと</button></div>` : "";
    root.innerHTML = `${options.back ? adminHeader("全体の学習分析", "学生全体の正答率と苦手傾向", options.back) : ""}${switchHtml}<div id="analyticsView">${overallHtml}</div>`;
    if (personal) {
      const views = { overall: overallHtml, subjects: subjectHtml, units: unitHtml };
      root.querySelectorAll("[data-analysis-view]").forEach((button) => button.addEventListener("click", () => {
        root.querySelectorAll("[data-analysis-view]").forEach((item) => item.classList.toggle("active", item === button));
        root.querySelector("#analyticsView").innerHTML = views[button.dataset.analysisView] || overallHtml;
      }));
    }
    if (options.back) bindAdminBack(root, options.back);
  } catch (error) {
    root.innerHTML = `${options.back ? adminHeader("全体の学習分析", "学生全体の正答率と苦手傾向", options.back) : ""}<section class="panel"><div class="empty"><strong>分析データを読み込めませんでした</strong><p>${escapeHtml(error.message)}</p><button id="retryAnalytics" class="primary-button" type="button">再読み込み</button></div></section>`;
    if (options.back) bindAdminBack(root, options.back);
    root.querySelector("#retryAnalytics")?.addEventListener("click", () => renderAnalytics(root, context, options));
  }
}

async function renderTestManager(root, context) {
  root.innerHTML = `${adminHeader("テスト管理", "最初に編集する区分を選択します", () => renderAdminMenu(root, context))}<section class="panel"><div class="panel-header"><div><h2>区分</h2><p>年度・学期など、科目をまとめる区分を設定します。</p></div></div><form id="categoryCreateForm" class="inline-create-form"><input name="name" maxlength="80" placeholder="例：2026年度 後期" required><input name="order" type="number" value="0" aria-label="表示順"><button class="primary-button" type="submit">区分を追加</button></form><div id="categoryList" class="admin-list"><p class="empty">読み込み中…</p></div></section>`;
  bindAdminBack(root, () => renderAdminMenu(root, context));
  const categories = await listCategories();
  const categoryList = root.querySelector("#categoryList");
  categoryList.innerHTML = categories.length ? categories.map((category) => `<article class="admin-row navigation-row"><button class="row-main-button" data-open-category="${category.id}" type="button"><span class="row-icon">🗂️</span><span><strong>${escapeHtml(category.name)}</strong><small>表示順 ${Number(category.order) || 0}・科目一覧へ</small></span><i>›</i></button><div class="inline-actions"><button class="secondary-button compact-button" data-edit-category="${category.id}" type="button">編集</button><button class="danger-button compact-button" data-delete-category="${category.id}" type="button">削除</button></div></article>`).join("") : `<div class="empty">区分はまだありません。上の入力欄から追加してください。</div>`;

  const categoryForm = async (category = {}) => {
    const result = await context.form("区分", [{ name: "name", label: "区分名", value: category.name || "", required: true }, { name: "order", label: "表示順", type: "number", value: category.order || 0 }]);
    if (!result) return; await saveCategory({ id: category.id, ...result }); renderTestManager(root, context);
  };
  root.querySelector("#categoryCreateForm").addEventListener("submit", async (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget)); await saveCategory(values); renderTestManager(root, context); });
  categoryList.querySelectorAll("[data-edit-category]").forEach((button) => button.addEventListener("click", () => categoryForm(categories.find((item) => item.id === button.dataset.editCategory))));
  categoryList.querySelectorAll("[data-delete-category]").forEach((button) => button.addEventListener("click", async () => { if (await context.confirm("この区分を削除しますか？科目は自動削除されません。")) { await removeCategory(button.dataset.deleteCategory); renderTestManager(root, context); } }));
  categoryList.querySelectorAll("[data-open-category]").forEach((button) => button.addEventListener("click", () => renderSubjectManager(root, context, categories.find((item) => item.id === button.dataset.openCategory))));
}

async function renderSubjectManager(root, context, category) {
  const subjects = (await listSubjects()).filter((item) => item.categoryId === category.id);
  root.innerHTML = `${adminHeader(category.name, "科目の登録・公開設定", () => renderTestManager(root, context))}<section class="panel"><div class="panel-header"><div><h2>科目一覧</h2><p>科目を選ぶと単元の登録画面へ進みます。</p></div><span class="chip">${subjects.length}科目</span></div><form id="subjectCreateForm" class="inline-create-form"><input name="name" maxlength="100" placeholder="科目名" required><input name="order" type="number" value="0" aria-label="表示順"><label class="checkbox-row"><input name="published" type="checkbox">公開</label><button class="primary-button" type="submit">科目を追加</button></form><div id="subjectList" class="admin-list">${subjects.length ? subjects.map((subject) => `<article class="admin-row navigation-row"><button class="row-main-button" data-open-subject="${subject.id}" type="button"><span class="row-icon">📘</span><span><strong>${escapeHtml(subject.name)}</strong><small>${subject.published ? "公開中" : "非公開"}・単元一覧へ</small></span><i>›</i></button><div class="inline-actions"><button class="secondary-button compact-button" data-edit-subject="${subject.id}" type="button">設定</button><button class="danger-button compact-button" data-delete-subject="${subject.id}" type="button">削除</button></div></article>`).join("") : `<div class="empty">この区分に科目はありません。</div>`}</div></section>`;
  bindAdminBack(root, () => renderTestManager(root, context));
  const subjectForm = async (subject = {}) => {
    const result = await context.form("科目設定", [{ name: "name", label: "科目名", value: subject.name || "", required: true }, { name: "order", label: "表示順", type: "number", value: subject.order || 0 }, { name: "published", label: "学生に公開", type: "checkbox", value: subject.published === true }]);
    if (!result) return; await saveSubject({ id: subject.id, categoryId: category.id, ...result }); renderSubjectManager(root, context, category);
  };
  root.querySelector("#subjectCreateForm").addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); await saveSubject({ ...values, categoryId: category.id, published: form.elements.published.checked }); renderSubjectManager(root, context, category); });
  root.querySelectorAll("[data-edit-subject]").forEach((button) => button.addEventListener("click", () => subjectForm(subjects.find((item) => item.id === button.dataset.editSubject))));
  root.querySelectorAll("[data-delete-subject]").forEach((button) => button.addEventListener("click", async () => { if (await context.confirm("この科目を削除しますか？配下の単元も見えなくなります。")) { await removeSubject(button.dataset.deleteSubject); renderSubjectManager(root, context, category); } }));
  root.querySelectorAll("[data-open-subject]").forEach((button) => button.addEventListener("click", () => renderUnitManager(root, context, category, subjects.find((item) => item.id === button.dataset.openSubject))));
}

async function renderUnitManager(root, context, category, subject) {
  const units = await listUnits(subject.id);
  root.innerHTML = `${adminHeader(subject.name, `${category.name} / 単元と問題`, () => renderSubjectManager(root, context, category))}<section class="panel"><div class="panel-header"><div><h2>単元一覧</h2><p>単元を登録した後、「問題を編集」から問題作成へ進みます。</p></div><span class="chip">${units.length}単元</span></div><form id="unitCreateForm" class="unit-create-form"><div class="split"><label>単元名<input name="name" required maxlength="100"></label><label>試験範囲<input name="range" maxlength="300"></label></div><div class="inline-create-form"><input name="order" type="number" value="0" aria-label="表示順"><label class="checkbox-row"><input name="published" type="checkbox">公開</label><button class="primary-button" type="submit">単元を追加</button></div></form><div id="unitList" class="admin-list">${units.length ? units.map((unit) => `<article class="admin-row unit-management-row"><div><strong>${escapeHtml(unit.name)}</strong><p>${unit.published ? "公開中" : "非公開"} / 穴埋め ${(unit.fill_blank || []).length}問 / 選択 ${(unit.quiz || []).length}問</p></div><div class="inline-actions"><button class="primary-button" data-edit-questions="${unit.id}" type="button">問題を編集</button><button class="secondary-button compact-button" data-edit-unit="${unit.id}" type="button">単元設定</button><button class="danger-button compact-button" data-delete-unit="${unit.id}" type="button">削除</button></div></article>`).join("") : `<div class="empty">単元はまだありません。</div>`}</div></section>`;
  bindAdminBack(root, () => renderSubjectManager(root, context, category));
  root.querySelector("#unitCreateForm").addEventListener("submit", async (event) => { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); await saveUnit(subject.id, { ...values, published: form.elements.published.checked, fill_blank: [], quiz: [] }); renderUnitManager(root, context, category, subject); });
  const editSettings = async (unit) => {
    const result = await context.form("単元設定", [{ name: "name", label: "単元名", value: unit.name || "", required: true }, { name: "range", label: "試験範囲", value: unit.range || "" }, { name: "order", label: "表示順", type: "number", value: unit.order || 0 }, { name: "published", label: "学生に公開", type: "checkbox", value: unit.published === true }]);
    if (!result) return;
    await saveUnit(subject.id, { ...unit, ...result });
    renderUnitManager(root, context, category, subject);
  };
  root.querySelectorAll("[data-edit-unit]").forEach((button) => button.addEventListener("click", () => editSettings(units.find((item) => item.id === button.dataset.editUnit))));
  root.querySelectorAll("[data-edit-questions]").forEach((button) => button.addEventListener("click", async () => {
    const fresh = await getUnit(subject.id, button.dataset.editQuestions);
    const result = await context.unitEditor(fresh, root);
    if (result) { await saveUnit(subject.id, { id: fresh.id, ...result }); context.toast("問題を保存しました。"); }
    await renderUnitManager(root, context, category, subject);
  }));
  root.querySelectorAll("[data-delete-unit]").forEach((button) => button.addEventListener("click", async () => { if (await context.confirm("この単元と問題を削除しますか？")) { await removeUnit(subject.id, button.dataset.deleteUnit); renderUnitManager(root, context, category, subject); } }));
}

async function renderReports(root, context) {
  root.innerHTML = `${adminHeader("問題の修正依頼", "学生・管理者から届いた報告", () => renderAdminMenu(root, context))}<div class="report-view-switch" role="tablist" aria-label="修正依頼の状態"><button class="active" data-report-view="open" type="button">未対応 <b id="openReportCount">0</b></button><button data-report-view="resolved" type="button">修正済み <b id="resolvedReportCount">0</b></button></div><section class="panel"><div class="panel-header"><div><h2 id="reportListTitle">未対応の修正依頼</h2><p>内容を確認し、修正後に「修正済みにする」を押してください。</p></div></div><div id="reportList" class="admin-list"><p class="empty">読み込み中…</p></div></section>`;
  bindAdminBack(root, () => renderAdminMenu(root, context));
  const reportList = root.querySelector("#reportList");
  try {
    const reports = await listQuestionReports();
    const openReports = reports.filter((item) => (item.status || "open") === "open");
    const resolvedReports = reports.filter((item) => item.status === "resolved");
    root.querySelector("#openReportCount").textContent = openReports.length;
    root.querySelector("#resolvedReportCount").textContent = resolvedReports.length;
    const showList = (view) => {
      const resolved = view === "resolved";
      const items = resolved ? resolvedReports : openReports;
      root.querySelector("#reportListTitle").textContent = resolved ? "修正済み一覧" : "未対応の修正依頼";
      root.querySelectorAll("[data-report-view]").forEach((button) => button.classList.toggle("active", button.dataset.reportView === view));
      reportList.innerHTML = items.length ? items.map((item) => `<article class="admin-row report-row"><div><strong>${escapeHtml(item.reason)}</strong><p class="report-question">${escapeHtml(item.question)}</p>${item.details ? `<div class="report-details"><b>修正内容</b><p>${escapeHtml(item.details)}</p></div>` : `<p class="hint">修正内容の入力はありません。</p>`}<p>${dateText(item.createdAt)} / ${escapeHtml(item.type)} ${Number(item.index) + 1}</p><small>${escapeHtml(item.reporterName || "学生")} ${item.reporterStudentNumber ? `（${escapeHtml(item.reporterStudentNumber)}）` : ""} / ${escapeHtml(item.subjectId || "")} / ${escapeHtml(item.unitId || "")}</small></div><div class="report-actions"><span class="chip ${resolved ? "" : "danger"}">${resolved ? "修正済み" : "未対応"}</span><button class="${resolved ? "secondary-button" : "primary-button"} compact-button" data-report-status="${escapeHtml(item.id)}" data-next-status="${resolved ? "open" : "resolved"}" type="button">${resolved ? "未対応へ戻す" : "修正済みにする"}</button></div></article>`).join("") : `<div class="empty">${resolved ? "修正済みの依頼はありません。" : "未対応の修正依頼はありません。"}</div>`;
      reportList.querySelectorAll("[data-report-status]").forEach((button) => button.addEventListener("click", async () => {
        try {
          context.loading(true, "修正依頼を更新中…");
          await updateQuestionReportStatus(button.dataset.reportStatus, button.dataset.nextStatus);
          context.toast(button.dataset.nextStatus === "resolved" ? "修正済み一覧へ移動しました。" : "未対応へ戻しました。");
          await renderReports(root, context);
        } catch (error) { context.toast(error.message || "状態を更新できませんでした。", true); } finally { context.loading(false); }
      }));
    };
    root.querySelectorAll("[data-report-view]").forEach((button) => button.addEventListener("click", () => showList(button.dataset.reportView)));
    showList("open");
  } catch (error) {
    reportList.innerHTML = `<div class="empty"><strong>修正依頼を読み込めませんでした</strong><p>${escapeHtml(error.message || "権限と通信状態を確認してください。")}</p><button id="retryReports" class="primary-button" type="button">再読み込み</button></div>`;
    root.querySelector("#retryReports")?.addEventListener("click", () => renderReports(root, context));
  }
}

export function parseUnitJson(text) {
  const value = JSON.parse(text);
  const source = Array.isArray(value) ? value[0] : value;
  if (!source || typeof source !== "object") throw new Error("JSONの内容を確認してください。");
  return normalizeUnitData(source);
}
