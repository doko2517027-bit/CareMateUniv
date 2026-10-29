import { auth, db } from "./firebase.js";
import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
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
  const quiz = Array.isArray(input.quiz) ? input.quiz.map((item) => ({
    question: safeText(item.question, 1000), choices: Array.isArray(item.choices) ? item.choices.map((choice) => safeText(choice, 500)).filter(Boolean) : [],
    answer: Math.max(0, Number(item.answer) || 0), answers: Array.isArray(item.answers) ? item.answers.map(Number).filter(Number.isInteger) : [],
    explanation: safeText(item.explanation, 2000),
  })).filter((item) => item.question && item.choices.length >= 2 && item.answer < item.choices.length) : [];
  const fillBlank = Array.isArray(input.fill_blank) ? input.fill_blank.map((item) => ({
    question: safeText(item.question, 1000), answers: Array.isArray(item.answers) ? item.answers.map((answer) => safeText(answer, 300)).filter(Boolean) : cleanLines(item.answer),
    explanation: safeText(item.explanation, 2000),
  })).filter((item) => item.question && item.answers.length) : [];
  let today = input.today_question && typeof input.today_question === "object" ? input.today_question : null;
  if (today) {
    const normalized = normalizeUnitData({ quiz: [today] }).quiz[0];
    today = normalized || null;
  }
  return {
    summary: Array.isArray(input.summary) ? input.summary.map((item) => safeText(item, 1000)).filter(Boolean) : cleanLines(input.summary),
    important_points: Array.isArray(input.important_points) ? input.important_points.map((item) => safeText(item, 1000)).filter(Boolean) : cleanLines(input.important_points),
    fill_blank: fillBlank,
    quiz,
    today_question: today,
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
export async function reportQuestion({ uid, subjectId, unitId, type, index, reason, question }) {
  await addDoc(collection(db, COLLECTIONS.reports), { reporterUid: uid, subjectId, unitId, type, index, reason: safeText(reason, 80), question: safeText(question, 1000), status: "open", createdAt: serverTimestamp() });
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
