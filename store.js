import { auth, db } from "./firebase.js?v=7";
import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

export const COLLECTIONS = Object.freeze({
  users: "studyAppUsers",
  invites: "studyAppInvites",
  categories: "studyAppCategories",
  subjects: "studyAppSubjects",
  reports: "studyAppReports",
});

export function cleanLines(value) {
  return String(value || "").split("\n").map((line) => line.trim()).filter(Boolean);
}
export function safeText(value, limit = 500) { return String(value ?? "").trim().slice(0, limit); }
export function newCode(length = 24) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

export async function listCategories() {
  const snapshots = await getDocs(query(collection(db, COLLECTIONS.categories), orderBy("order", "asc")));
  return snapshots.docs.map((item) => ({ id: item.id, ...item.data() }));
}
export async function saveCategory({ id, name, order = 0 }) {
  const data = { name: safeText(name, 80), order: Number(order) || 0, updatedAt: serverTimestamp() };
  if (!data.name) throw new Error("区分名を入力してください。");
  if (id) { await setDoc(doc(db, COLLECTIONS.categories, id), data, { merge: true }); return id; }
  return (await addDoc(collection(db, COLLECTIONS.categories), { ...data, createdAt: serverTimestamp() })).id;
}
export async function removeCategory(id) { await deleteDoc(doc(db, COLLECTIONS.categories, id)); }

export async function listSubjects({ publishedOnly = false } = {}) {
  const constraints = publishedOnly ? [where("published", "==", true)] : [];
  const snapshots = await getDocs(query(collection(db, COLLECTIONS.subjects), ...constraints));
  const items = snapshots.docs.map((item) => ({ id: item.id, ...item.data() }));
  return items.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.name).localeCompare(String(b.name), "ja"));
}
export async function saveSubject({ id, name, categoryId, published = false, order = 0 }) {
  const data = { name: safeText(name, 100), categoryId: safeText(categoryId, 100), published: published === true, order: Number(order) || 0, updatedAt: serverTimestamp() };
  if (!data.name || !data.categoryId) throw new Error("科目名と区分を入力してください。");
  if (id) { await setDoc(doc(db, COLLECTIONS.subjects, id), data, { merge: true }); return id; }
  return (await addDoc(collection(db, COLLECTIONS.subjects), { ...data, createdAt: serverTimestamp() })).id;
}
export async function removeSubject(id) { await deleteDoc(doc(db, COLLECTIONS.subjects, id)); }

export async function listUnits(subjectId, { publishedOnly = false } = {}) {
  const unitsRef = collection(db, COLLECTIONS.subjects, subjectId, "units");
  const snapshots = await getDocs(publishedOnly ? query(unitsRef, where("published", "==", true)) : unitsRef);
  return snapshots.docs.map((item) => ({ id: item.id, ...item.data() }))
    .filter((item) => !publishedOnly || item.published === true)
    .sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.name).localeCompare(String(b.name), "ja"));
}
export async function getUnit(subjectId, unitId) {
  const snapshot = await getDoc(doc(db, COLLECTIONS.subjects, subjectId, "units", unitId));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}
export function normalizeUnitData(input = {}) {
  const imageFields = (item) => ({
    imageUrl: safeText(item.imageUrl, 1500),
    imagePublicId: safeText(item.imagePublicId, 500),
    imageDescription: safeText(item.imageDescription, 1000),
  });
  const quiz = Array.isArray(input.quiz) ? input.quiz.map((item) => {
    const choices = Array.isArray(item.choices) ? item.choices.map((choice) => safeText(choice, 500)).filter(Boolean) : [];
    const fallback = Math.max(0, Number(item.answer) || 0);
    const answers = (Array.isArray(item.answers) && item.answers.length ? item.answers : [fallback])
      .map(Number).filter((value, index, values) => Number.isInteger(value) && value >= 0 && value < choices.length && values.indexOf(value) === index);
    return { question: safeText(item.question, 1000), choices, answer: answers[0] ?? 0, ...(answers.length > 1 ? { answers } : {}), explanation: safeText(item.explanation, 2000), ...imageFields(item) };
  }).filter((item) => item.question && item.choices.length >= 2 && item.answer < item.choices.length) : [];
  const fillBlank = Array.isArray(input.fill_blank) ? input.fill_blank.map((item) => {
    const answers = Array.isArray(item.answers) ? item.answers.map((answer) => safeText(answer, 300)).filter(Boolean) : cleanLines(item.answer);
    return { question: safeText(item.question, 1000), answer: safeText(item.answer, 500) || answers.join("・"), answers, explanation: safeText(item.explanation, 2000), ...imageFields(item) };
  }).filter((item) => item.question && item.answers.length) : [];
  return {
    summary: Array.isArray(input.summary) ? input.summary.map((item) => safeText(item, 1000)).filter(Boolean) : cleanLines(input.summary),
    important_points: Array.isArray(input.important_points) ? input.important_points.map((item) => safeText(item, 1000)).filter(Boolean) : cleanLines(input.important_points),
    fill_blank: fillBlank,
    quiz,
    today_question: null,
  };
}
export async function saveUnit(subjectId, { id, name, range = "", published = false, order = 0, ...content }) {
  const data = { name: safeText(name, 100), range: safeText(range, 300), published: published === true, order: Number(order) || 0, ...normalizeUnitData(content), updatedAt: serverTimestamp() };
  if (!data.name) throw new Error("単元名を入力してください。");
  if (id) { await setDoc(doc(db, COLLECTIONS.subjects, subjectId, "units", id), data, { merge: true }); return id; }
  return (await addDoc(collection(db, COLLECTIONS.subjects, subjectId, "units"), { ...data, createdAt: serverTimestamp() })).id;
}
export async function removeUnit(subjectId, unitId) { await deleteDoc(doc(db, COLLECTIONS.subjects, subjectId, "units", unitId)); }

export async function getProgress(uid, subjectId, unitId) {
  const id = `${subjectId}_${unitId}`;
  const snapshot = await getDoc(doc(db, COLLECTIONS.users, uid, "progress", id));
  return snapshot.exists() ? snapshot.data() : {};
}
export async function saveProgress(uid, subjectId, unitId, patch) {
  const id = `${subjectId}_${unitId}`;
  await setDoc(doc(db, COLLECTIONS.users, uid, "progress", id), { ...patch, subjectId, unitId, updatedAt: serverTimestamp() }, { merge: true });
}
export async function listAllProgress() {
  const snapshot = await getDocs(collectionGroup(db, "progress"));
  return snapshot.docs.map((item) => ({
    id: item.id,
    uid: item.ref.parent.parent?.id || "",
    ...item.data(),
  }));
}
export async function listProgress(uid) {
  const snapshot = await getDocs(collection(db, COLLECTIONS.users, uid, "progress"));
  return snapshot.docs.map((item) => ({ id: item.id, uid, ...item.data() }));
}
export async function reportQuestion({ uid, studentNumber = "", reporterName = "", subjectId, unitId, type, index, reason, details = "", question }) {
  const reference = await addDoc(collection(db, COLLECTIONS.reports), { reporterUid: uid, reporterStudentNumber: safeText(studentNumber, 7), reporterName: safeText(reporterName, 80), subjectId, unitId, type, index, reason: safeText(reason, 80), details: safeText(details, 1200), question: safeText(question, 1000), status: "open", createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  const confirmation = await getDoc(reference);
  if (!confirmation.exists()) throw new Error("修正依頼の保存を確認できませんでした。もう一度お試しください。");
  return reference.id;
}
export async function applyQuestionReportCorrection({ reportId, questionIndex, original, updated }) {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("ログインしてください。");
  if (!Number.isInteger(questionIndex) || questionIndex < 0) throw new Error("対象の問題番号が正しくありません。");
  const reportRef = doc(db, COLLECTIONS.reports, reportId);
  await runTransaction(db, async (transaction) => {
    const reportSnap = await transaction.get(reportRef);
    if (!reportSnap.exists()) throw new Error("この修正依頼は見つかりません。");
    const report = reportSnap.data();
    if ((report.status || "open") !== "open") throw new Error("この修正依頼は対応済みです。画面を再読み込みしてください。");
    const type = report.type;
    if (type !== "quiz" && type !== "fill_blank") throw new Error("この問題形式には対応していません。");
    if (!report.subjectId || !report.unitId) throw new Error("対象の単元が指定されていません。");
    const unitRef = doc(db, COLLECTIONS.subjects, report.subjectId, "units", report.unitId);
    const unitSnap = await transaction.get(unitRef);
    if (!unitSnap.exists()) throw new Error("対象の単元が削除されています。");
    const questions = unitSnap.data()[type];
    if (!Array.isArray(questions) || !questions[questionIndex]) throw new Error("対象の問題が見つかりません。");
    const current = questions[questionIndex];
    if (current.question !== report.question || JSON.stringify(current) !== JSON.stringify(original)) {
      throw new Error("対象の問題がすでに変更されています。修正依頼を開き直して内容を確認してください。");
    }
    const required = (value, limit, label) => {
      const text = String(value ?? "").trim();
      if (!text || text.length > limit) throw new Error(`${label}を入力し、${limit}文字以内にしてください。`);
      return text;
    };
    const explanation = String(updated.explanation ?? "").trim();
    if (explanation.length > 2000) throw new Error("解説は2000文字以内で入力してください。");
    const corrected = {
      ...current,
      question: required(updated.question, 1000, "問題文"),
      explanation,
    };
    if (type === "quiz") {
      if (!Array.isArray(updated.choices) || updated.choices.length < 2 || updated.choices.length > 50) {
        throw new Error("選択肢は2個以上50個以下にしてください。");
      }
      const choices = updated.choices.map((choice) => required(choice, 500, "選択肢"));
      if (!Array.isArray(updated.answers) || !updated.answers.length ||
          updated.answers.some((answer) => !Number.isInteger(answer) || answer < 0 || answer >= choices.length) ||
          new Set(updated.answers).size !== updated.answers.length) {
        throw new Error("正解の選択肢を1つ以上選んでください。");
      }
      corrected.choices = choices;
      corrected.answer = updated.answers[0];
      if (updated.answers.length > 1) corrected.answers = updated.answers;
      else delete corrected.answers;
    } else {
      if (!Array.isArray(updated.answers) || !updated.answers.length || updated.answers.length > 30) {
        throw new Error("穴埋めの解答を1～30個入力してください。");
      }
      const answers = updated.answers.map((value) => required(value, 300, "穴埋めの解答"));
      corrected.answers = answers;
      corrected.answer = required(updated.answer || answers.join("・"), 500, "表示する答え");
    }
    const next = [...questions];
    next[questionIndex] = corrected;
    transaction.update(unitRef, { [type]: next, updatedAt: serverTimestamp() });
    transaction.update(reportRef, {
      status: "resolved",
      resolvedAt: serverTimestamp(),
      resolvedByUid: currentUser.uid,
      updatedAt: serverTimestamp(),
    });
  });
}

export async function listQuestionReports() {
  const snapshot = await getDocs(collection(db, COLLECTIONS.reports));
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))
    .sort((a, b) => Number(b.createdAt?.seconds || 0) - Number(a.createdAt?.seconds || 0));
}
export function watchOpenQuestionReports(onChange, onError = () => {}) {
  return onSnapshot(query(collection(db, COLLECTIONS.reports), where("status", "==", "open")), (snapshot) => {
    onChange(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
  }, onError);
}
export async function updateQuestionReportStatus(reportId, status) {
  if (!['open', 'resolved'].includes(status)) throw new Error("修正依頼の状態が正しくありません。");
  await updateDoc(doc(db, COLLECTIONS.reports, reportId), {
    status,
    resolvedAt: status === "resolved" ? serverTimestamp() : null,
    resolvedByUid: status === "resolved" ? auth.currentUser?.uid || "" : "",
    updatedAt: serverTimestamp(),
  });
}

export async function listUsersAndInvites() {
  const [users, invites] = await Promise.all([getDocs(collection(db, COLLECTIONS.users)), getDocs(collection(db, COLLECTIONS.invites))]);
  return {
    users: users.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => String(a.studentNumber).localeCompare(String(b.studentNumber))),
    invites: invites.docs.map((item) => ({ code: item.id, ...item.data() })).sort((a, b) => String(a.studentNumber).localeCompare(String(b.studentNumber))),
  };
}
export async function createAdminInvite({ studentNumber, name }) {
  const number = safeText(studentNumber, 7);
  if (!/^\d{7}$/.test(number)) throw new Error("学籍番号は7桁で入力してください。");
  const code = newCode();
  await setDoc(doc(db, COLLECTIONS.invites, code), { studentNumber: number, name: safeText(name, 80) || "管理者", role: "admin", active: true, bootstrap: false, createdAt: serverTimestamp() });
  return code;
}
export async function cancelInvite(code) { await deleteDoc(doc(db, COLLECTIONS.invites, code)); }
export async function updateUserAccess(uid, patch) {
  const allowed = {};
  if (typeof patch.active === "boolean") allowed.active = patch.active;
  await updateDoc(doc(db, COLLECTIONS.users, uid), { ...allowed, updatedAt: serverTimestamp() });
}

export async function deleteStudyUser(uid) {
  const current = auth.currentUser;
  if (!current) throw new Error("ログインしてください。");
  const token = await current.getIdToken();
  const response = await fetch("https://caremate-auth.onrender.com/api/deleteStudyAppUser", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ data: { targetUid: uid } }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || "登録情報を削除できませんでした。");
  return body.data;
}

export async function resetStudyUserPassword(targetUid, nextPassword) {
  const current = auth.currentUser;
  if (!current) throw new Error("ログインしてください。");
  const token = await current.getIdToken();
  const response = await fetch("https://caremate-auth.onrender.com/api/adminResetStudyAppPassword", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ data: { targetUid, nextPassword } }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || "パスワードを変更できませんでした。");
  return body.data;
}
