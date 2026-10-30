import { auth } from "./firebase.js?v=8";
import {
  listAnnouncements,
  markAllAnnouncementsRead,
  markAnnouncementRead,
  removeAnnouncement,
  saveAnnouncement,
  watchAnnouncementReads,
  watchAnnouncements,
} from "./store.js?v=13";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const allowedTags = new Set(["P", "DIV", "BR", "STRONG", "B", "U", "SPAN", "FONT", "H2", "H3", "UL", "OL", "LI"]);
const allowedFormatClasses = new Set(["notice-size-14", "notice-size-16", "notice-size-20", "notice-size-24", "notice-color-default", "notice-color-red", "notice-color-blue", "notice-color-green", "notice-color-purple", "notice-color-orange", "notice-font-sans", "notice-font-serif", "notice-font-rounded", "notice-underline"]);
let stopAnnouncementView = null;
let stopReadView = null;

function safeCloudinaryUrl(value) {
  const url = String(value || "").trim();
  return /^https:\/\/res\.cloudinary\.com\//.test(url) ? url : "";
}

function closestNoticeColor(value) {
  const palettes = [
    [20, 43, 50, "notice-color-default"], [209, 61, 76, "notice-color-red"],
    [7, 140, 156, "notice-color-blue"], [22, 136, 102, "notice-color-green"],
    [124, 58, 237, "notice-color-purple"], [223, 122, 36, "notice-color-orange"],
  ];
  const text = String(value || "").trim().toLowerCase();
  let rgb = null;
  if (/^#[0-9a-f]{6}$/.test(text)) rgb = [1, 3, 5].map((index) => parseInt(text.slice(index, index + 2), 16));
  const match = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/.exec(text);
  if (match) rgb = match.slice(1).map(Number);
  if (!rgb) return "";
  return palettes.reduce((best, item) => {
    const distance = (rgb[0] - item[0]) ** 2 + (rgb[1] - item[1]) ** 2 + (rgb[2] - item[2]) ** 2;
    return distance < best.distance ? { distance, name: item[3] } : best;
  }, { distance: Infinity, name: "" }).name;
}

export function sanitizeNoticeHtml(source) {
  const parsed = new DOMParser().parseFromString(`<div>${String(source || "")}</div>`, "text/html");
  const root = parsed.body.firstElementChild;
  const cleanNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || "");
    if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();
    if (!allowedTags.has(node.tagName)) {
      const fragment = document.createDocumentFragment();
      [...node.childNodes].forEach((child) => fragment.append(cleanNode(child)));
      return fragment;
    }
    const element = document.createElement(node.tagName === "FONT" ? "span" : node.tagName.toLowerCase());
    if (["SPAN", "FONT"].includes(node.tagName)) {
      const classes = new Set([...node.classList].filter((name) => allowedFormatClasses.has(name)));
      const color = node.getAttribute("color") || node.style.color;
      const face = String(node.getAttribute("face") || node.style.fontFamily || "").toLowerCase();
      const size = node.style.fontSize;
      const decoration = node.style.textDecoration;
      const colorClass = closestNoticeColor(color);
      if (colorClass) classes.add(colorClass);
      if (["14px", "16px", "20px", "24px"].includes(size)) classes.add(`notice-size-${size.replace("px", "")}`);
      if (decoration.includes("underline")) classes.add("notice-underline");
      if (face.includes("serif") || face.includes("mincho")) classes.add("notice-font-serif");
      else if (face.includes("rounded")) classes.add("notice-font-rounded");
      else if (face) classes.add("notice-font-sans");
      if (classes.size) element.className = [...classes].join(" ");
    }
    [...node.childNodes].forEach((child) => element.append(cleanNode(child)));
    return element;
  };
  const output = document.createElement("div");
  [...root.childNodes].forEach((child) => output.append(cleanNode(child)));
  return output.innerHTML;
}

function dateText(value) {
  const date = value?.toDate ? value.toDate() : null;
  return date ? date.toLocaleString("ja-JP", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "公開処理中";
}

function attachmentHtml(attachments = []) {
  const images = attachments.filter((item) => item.type === "image" && safeCloudinaryUrl(item.url));
  const pdfs = attachments.filter((item) => item.type === "pdf" && safeCloudinaryUrl(item.url));
  return `${images.length ? `<div class="notice-images">${images.map((item) => `<figure><img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.name || "お知らせ画像")}" loading="lazy"><figcaption>長押しで画像を保存できます</figcaption></figure>`).join("")}</div>` : ""}${pdfs.length ? `<div class="notice-pdfs">${pdfs.map((item, index) => `<button class="secondary-button" data-notice-pdf="${index}" data-url="${escapeHtml(item.url)}" type="button">PDFを開く：${escapeHtml(item.name || `資料${index + 1}`)}</button>`).join("")}</div>` : ""}`;
}

function announcementIsRead(item, reads) {
  return reads.has(item.id) && Number(reads.get(item.id) || 0) >= Number(item.notificationRevision || 0);
}

function openNoticeDetail(item, read, context, onRead) {
  const dialog = document.querySelector("#appDialog");
  const body = sanitizeNoticeHtml(item.bodyHtml || `<p>${escapeHtml(item.bodyText || "")}</p>`);
  document.querySelector("#dialogContent").innerHTML = `<article class="notice-detail"><header><span class="chip">お知らせ</span><h2>${escapeHtml(item.title)}</h2><time>${dateText(item.publishedAt || item.createdAt)}</time></header><div class="notice-body">${body}</div>${attachmentHtml(item.attachments)}${read ? `<p class="notice-read-state">既読</p>` : `<button id="markNoticeRead" class="primary-button" type="button">既読にする</button>`}</article>`;
  dialog.querySelectorAll("[data-notice-pdf]").forEach((button) => button.addEventListener("click", () => {
    const url = safeCloudinaryUrl(button.dataset.url);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }));
  dialog.querySelector("#markNoticeRead")?.addEventListener("click", async () => {
    try {
      await markAnnouncementRead(auth.currentUser.uid, item.id, item.notificationRevision);
      context.toast("既読にしました。");
      onRead?.();
      dialog.close();
    } catch (error) { context.toast(error.message || "既読にできませんでした。", true); }
  });
  if (!dialog.open) dialog.showModal();
}

function pageWindow(current, total) {
  if (total <= 3) return Array.from({ length: total }, (_, i) => i + 1);
  const start = Math.max(1, Math.min(current - 1, total - 2));
  return [start, start + 1, start + 2];
}

export function stopNoticeViewWatch() {
  stopAnnouncementView?.();
  stopReadView?.();
  stopAnnouncementView = null;
  stopReadView = null;
}

export function renderStudentNotices(root, context, { focusId = "" } = {}) {
  stopNoticeViewWatch();
  let announcements = [];
  let reads = new Map();
  let currentPage = 1;
  let focusPending = focusId;
  const paint = () => {
    const pageSize = 5;
    const totalPages = Math.max(1, Math.ceil(announcements.length / pageSize));
    currentPage = Math.min(currentPage, totalPages);
    const pageItems = announcements.slice((currentPage - 1) * pageSize, currentPage * pageSize);
    const unread = announcements.filter((item) => !announcementIsRead(item, reads));
    const notificationBanner = "Notification" in window && Notification.permission === "default"
      ? `<section class="notice-permission"><div><strong>お知らせをすぐ受け取る</strong><p>通知を許可すると、アプリを開いている端末ですぐにお知らせを確認できます。</p></div><button id="enableNoticeNotifications" class="primary-button" type="button">通知を許可</button></section>` : "";
    root.innerHTML = `<section class="hero notice-hero"><div><span class="chip">INFORMATION</span><h2>お知らせ</h2><p>学校・管理者からのお知らせを確認できます。</p></div><span class="hero-badge">未読 ${unread.length}</span></section>${notificationBanner}<section class="panel"><div class="panel-header"><div><h2>お知らせ一覧</h2><p>5件ずつ新しい順に表示します。</p></div>${unread.length ? `<button id="markAllNoticesRead" class="secondary-button compact-button" type="button">すべて既読</button>` : `<span class="chip">すべて既読</span>`}</div><div class="notice-list">${pageItems.length ? pageItems.map((item) => `<button class="notice-row ${announcementIsRead(item, reads) ? "is-read" : "is-unread"}" data-notice-id="${escapeHtml(item.id)}" type="button"><span class="notice-unread-dot" aria-hidden="true"></span><span><strong>${escapeHtml(item.title)}</strong><small>${dateText(item.publishedAt || item.createdAt)}</small></span><i>›</i></button>`).join("") : `<div class="empty">お知らせはまだありません。</div>`}</div>${totalPages > 1 ? `<nav class="notice-pagination" aria-label="お知らせページ"><button data-page-action="first" ${currentPage === 1 ? "disabled" : ""} type="button">最初</button><button data-page-action="prev" ${currentPage === 1 ? "disabled" : ""} type="button">‹</button>${pageWindow(currentPage, totalPages).map((page) => `<button data-notice-page="${page}" class="${page === currentPage ? "active" : ""}" type="button">${page}</button>`).join("")}<button data-page-action="next" ${currentPage === totalPages ? "disabled" : ""} type="button">›</button><button data-page-action="last" ${currentPage === totalPages ? "disabled" : ""} type="button">最後</button></nav>` : ""}</section>`;
    root.querySelectorAll("[data-notice-id]").forEach((button) => button.addEventListener("click", () => {
      const item = announcements.find((entry) => entry.id === button.dataset.noticeId);
      if (item) openNoticeDetail(item, announcementIsRead(item, reads), context, paint);
    }));
    root.querySelector("#markAllNoticesRead")?.addEventListener("click", async () => {
      try { context.loading(true, "既読にしています…"); await markAllAnnouncementsRead(auth.currentUser.uid, unread); context.toast("すべて既読にしました。"); }
      catch (error) { context.toast(error.message || "既読にできませんでした。", true); }
      finally { context.loading(false); }
    });
    root.querySelector("#enableNoticeNotifications")?.addEventListener("click", async () => {
      const permission = await Notification.requestPermission();
      context.toast(permission === "granted" ? "お知らせ通知を有効にしました。" : "ブラウザ設定で通知を許可してください。", permission !== "granted");
      paint();
    });
    root.querySelectorAll("[data-notice-page]").forEach((button) => button.addEventListener("click", () => { currentPage = Number(button.dataset.noticePage); paint(); }));
    root.querySelectorAll("[data-page-action]").forEach((button) => button.addEventListener("click", () => {
      if (button.dataset.pageAction === "first") currentPage = 1;
      if (button.dataset.pageAction === "prev") currentPage = Math.max(1, currentPage - 1);
      if (button.dataset.pageAction === "next") currentPage = Math.min(totalPages, currentPage + 1);
      if (button.dataset.pageAction === "last") currentPage = totalPages;
      paint();
    }));
    if (focusPending) {
      const item = announcements.find((entry) => entry.id === focusPending);
      focusPending = "";
      if (item) queueMicrotask(() => openNoticeDetail(item, announcementIsRead(item, reads), context, paint));
    }
  };
  root.innerHTML = `<section class="panel"><div class="empty">お知らせを読み込んでいます…</div></section>`;
  stopAnnouncementView = watchAnnouncements({}, (items) => { announcements = items; paint(); }, (error) => { root.innerHTML = `<section class="panel"><div class="empty">お知らせを読み込めませんでした。<br>${escapeHtml(error.message || "通信状態を確認してください。")}</div></section>`; });
  stopReadView = watchAnnouncementReads(auth.currentUser.uid, (items) => { reads = items; paint(); });
}

async function uploadNoticeFile(file) {
  const image = file.type.startsWith("image/");
  const pdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  if (!image && !pdf) throw new Error("画像またはPDFを選択してください。");
  if (file.size > (image ? 10 : 20) * 1024 * 1024) throw new Error(image ? "画像は10MB以下にしてください。" : "PDFは20MB以下にしてください。");
  const form = new FormData();
  form.append("file", file);
  form.append("upload_preset", "caremate_upload");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch("https://api.cloudinary.com/v1_1/vpctonjf/auto/upload", { method: "POST", body: form, signal: controller.signal });
    const data = await response.json();
    if (!response.ok || !safeCloudinaryUrl(data.secure_url)) throw new Error("ファイルをアップロードできませんでした。");
    return { type: pdf ? "pdf" : "image", url: data.secure_url, publicId: data.public_id || "", name: file.name };
  } finally { clearTimeout(timer); }
}

function adminHeader(onBack) {
  return `<div class="study-header"><button class="back-button" id="noticeAdminBack" type="button" aria-label="管理メニューへ戻る">‹</button><div><span class="brand-mini">ADMIN</span><h2>お知らせ管理</h2><p>書式・画像・PDFを含むお知らせを即時公開します。</p></div></div>`;
}

export async function renderAnnouncementManager(root, context, onBack) {
  let items = [];
  try { items = await listAnnouncements({ admin: true }); }
  catch (error) { context.toast(error.message || "お知らせを読み込めませんでした。", true); }
  let editing = null;
  let attachments = [];
  const render = () => {
    const notificationLabel = editing ? "編集内容を学生・管理者へ通知する" : "学生・管理者へ新着通知を送る";
    root.innerHTML = `${adminHeader(onBack)}<section class="panel notice-admin-editor">
      <div class="panel-header"><div><h2>${editing ? "お知らせを編集" : "新しいお知らせ"}</h2><p>通知の有無を選んで公開できます。</p></div>${editing ? `<button id="cancelNoticeEdit" class="secondary-button compact-button" type="button">新規作成へ戻る</button>` : ""}</div>
      <form id="noticeAdminForm" class="form-stack">
        <label>見出し<input name="title" maxlength="120" required value="${escapeHtml(editing?.title || "")}" placeholder="お知らせの見出し"></label>
        <label>本文</label>
        <div class="rich-toolbar" role="toolbar" aria-label="本文の書式"><button data-rich-command="bold" type="button"><b>太字</b></button><button data-rich-command="underline" type="button"><u>下線</u></button><select id="noticeFontSize" aria-label="文字サイズ"><option value="14">小</option><option value="16" selected>標準</option><option value="20">大</option><option value="24">特大</option></select><label>文字色<input id="noticeTextColor" type="color" value="#142b32"></label></div>
        <div id="noticeRichEditor" class="rich-editor" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="お知らせ本文を入力してください">${sanitizeNoticeHtml(editing?.bodyHtml || "")}</div>
        <section class="notice-upload"><div><strong>写真・PDF</strong><small>写真10MB、PDF20MBまで。最大12件。アップロードしても入力中の文章は保持されます。</small></div><input id="noticeAttachmentInput" type="file" accept="image/*,application/pdf" multiple><div id="noticeAttachmentList" class="notice-attachment-editor"></div></section>
        <label class="checkbox-row notice-send-option"><input name="sendNotification" type="checkbox" ${editing ? "" : "checked"}><span><strong>${notificationLabel}</strong><small>${editing ? "チェックした場合は既読済みの人にも再通知し、未読へ戻します。" : "チェックを外すと、お知らせ一覧だけに静かに追加します。"}</small></span></label>
        <button class="primary-button" type="submit">${editing ? "変更を公開" : "お知らせを公開"}</button><p id="noticeAdminStatus" class="status"></p>
      </form></section>
      <section class="panel"><div class="panel-header"><div><h2>公開済みのお知らせ</h2><p>新しい順に表示しています。</p></div><span class="chip">${items.length}件</span></div><div class="admin-list">${items.length ? items.map((item) => `<article class="admin-row"><div><strong>${escapeHtml(item.title)}</strong><p>${dateText(item.publishedAt || item.createdAt)}</p><small>${escapeHtml(String(item.bodyText || "").slice(0, 100))}</small></div><div class="inline-actions"><button class="secondary-button compact-button" data-edit-notice="${escapeHtml(item.id)}" type="button">編集</button><button class="danger-button compact-button" data-delete-notice="${escapeHtml(item.id)}" type="button">削除</button></div></article>`).join("") : `<div class="empty">公開済みのお知らせはありません。</div>`}</div></section>`;
    root.querySelector("#noticeAdminBack").onclick = onBack;
    root.querySelector("#cancelNoticeEdit")?.addEventListener("click", () => { editing = null; attachments = []; render(); });
    const editor = root.querySelector("#noticeRichEditor");
    const attachmentList = root.querySelector("#noticeAttachmentList");
    const paintAttachments = () => {
      attachmentList.innerHTML = attachments.length ? attachments.map((item, index) => `<article>${item.type === "image" ? `<img src="${escapeHtml(item.url)}" alt="">` : `<span class="pdf-file-mark">PDF</span>`}<b>${escapeHtml(item.name)}</b><button data-remove-notice-attachment="${index}" class="danger-button compact-button" type="button">削除</button></article>`).join("") : `<p class="hint">添付ファイルはありません。</p>`;
      attachmentList.querySelectorAll("[data-remove-notice-attachment]").forEach((button) => button.addEventListener("click", () => {
        attachments.splice(Number(button.dataset.removeNoticeAttachment), 1);
        paintAttachments();
      }));
    };
    paintAttachments();
    root.querySelector("#noticeFontSize").insertAdjacentHTML("beforebegin", `<select id="noticeFontFamily" aria-label="字体"><option value="sans-serif">ゴシック</option><option value="serif">明朝</option><option value="Arial Rounded MT Bold">丸ゴシック</option></select>`);
    root.querySelectorAll("[data-rich-command]").forEach((button) => button.addEventListener("mousedown", (event) => { event.preventDefault(); document.execCommand(button.dataset.richCommand); editor.focus(); }));
    root.querySelector("#noticeFontSize").addEventListener("change", (event) => { document.execCommand("fontSize", false, "7"); editor.querySelectorAll('font[size="7"]').forEach((node) => { const span = document.createElement("span"); span.style.fontSize = `${event.target.value}px`; span.innerHTML = node.innerHTML; node.replaceWith(span); }); editor.focus(); });
    root.querySelector("#noticeFontFamily").addEventListener("change", (event) => { document.execCommand("fontName", false, event.target.value); editor.focus(); });
    root.querySelector("#noticeTextColor").addEventListener("input", (event) => { document.execCommand("foreColor", false, event.target.value); editor.focus(); });
    root.querySelector("#noticeAttachmentInput").addEventListener("change", async (event) => {
      const files = [...event.target.files];
      if (attachments.length + files.length > 12) { context.toast("添付は最大12件です。", true); return; }
      try {
        context.loading(true, "ファイルをアップロード中…");
        for (const file of files) attachments.push(await uploadNoticeFile(file));
        paintAttachments();
        event.target.value = "";
        context.toast("添付ファイルを追加しました。");
      } catch (error) { context.toast(error.message || "アップロードできませんでした。", true); }
      finally { context.loading(false); }
    });
    root.querySelector("#noticeAdminForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const cleanHtml = sanitizeNoticeHtml(editor.innerHTML);
      const bodyText = editor.innerText.trim();
      if (!bodyText) { root.querySelector("#noticeAdminStatus").textContent = "本文を入力してください。"; root.querySelector("#noticeAdminStatus").className = "status error"; return; }
      try {
        context.loading(true, editing ? "お知らせを更新中…" : "お知らせを公開中…");
        const sendNotification = event.currentTarget.elements.sendNotification.checked;
        await saveAnnouncement({ id: editing?.id || "", title: event.currentTarget.elements.title.value, bodyHtml: cleanHtml, bodyText, attachments, published: true, sendNotification });
        context.toast(`${editing ? "お知らせを更新" : "お知らせを公開"}しました。${sendNotification ? "通知も送信しました。" : "通知は送信していません。"}`);
        items = await listAnnouncements({ admin: true }); editing = null; attachments = []; render();
      } catch (error) { context.toast(error.message || "お知らせを保存できませんでした。", true); }
      finally { context.loading(false); }
    });
    root.querySelectorAll("[data-edit-notice]").forEach((button) => button.addEventListener("click", () => { editing = items.find((item) => item.id === button.dataset.editNotice) || null; attachments = structuredClone(editing?.attachments || []); render(); window.scrollTo({ top: 0, behavior: "smooth" }); }));
    root.querySelectorAll("[data-delete-notice]").forEach((button) => button.addEventListener("click", async () => {
      if (!await context.confirm("このお知らせを削除しますか？")) return;
      try { context.loading(true, "お知らせを削除中…"); await removeAnnouncement(button.dataset.deleteNotice); items = await listAnnouncements({ admin: true }); if (editing?.id === button.dataset.deleteNotice) { editing = null; attachments = []; } render(); context.toast("お知らせを削除しました。"); }
      catch (error) { context.toast(error.message || "削除できませんでした。", true); }
      finally { context.loading(false); }
    }));
  };
  render();
}
