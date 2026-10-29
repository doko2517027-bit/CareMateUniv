import {
  adminAuthEmail,
  auth,
  db,
  isAdminAuthEmail,
  sumsEmail,
} from "./firebase.js?v=8";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  onAuthStateChanged,
  reload,
  sendEmailVerification,
  signInWithCustomToken,
  signOut,
  updatePassword,
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const PROFILE_COLLECTION = "studyAppUsers";
const INVITE_COLLECTION = "studyAppInvites";
const STUDENT_NUMBER_COLLECTION = "studyAppStudentNumbers";
const API_BASE = "https://caremate-auth.onrender.com/api";

async function callApi(method, data, { authenticated = false, timeout = 20_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const headers = { "content-type": "application/json" };
    if (authenticated) {
      if (!auth.currentUser) throw new Error("ログインしてください。");
      headers.authorization = `Bearer ${await auth.currentUser.getIdToken()}`;
    }
    const response = await fetch(`${API_BASE}/${method}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ data }),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body?.error?.message || "処理を完了できませんでした。");
      error.code = body?.error?.status || "unavailable";
      error.userMessage = body?.error?.message || "";
      throw error;
    }
    return body.data;
  } catch (error) {
    if (error?.name === "AbortError") {
      const timeoutError = new Error("通信に時間がかかっています。少し待ってからもう一度お試しください。");
      timeoutError.code = "unavailable";
      timeoutError.userMessage = timeoutError.message;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function cleanStudentNumber(value) {
  const number = String(value || "").trim();
  if (!/^\d{7}$/.test(number)) throw new Error("学籍番号は7桁で入力してください。");
  return number;
}

export function authReady() {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (user) => { stop(); resolve(user); });
  });
}

export async function registerStudentAccount({ emailLocal, password }) {
  const result = await createUserWithEmailAndPassword(auth, sumsEmail(emailLocal), password);
  auth.languageCode = "ja";
  await sendEmailVerification(result.user);
  return result.user;
}

export async function beginAdminRegistration({ studentNumber, registrationCode }) {
  const number = cleanStudentNumber(studentNumber);
  const code = String(registrationCode || "").trim();
  if (code.length < 12) throw new Error("入力内容を確認してください。");
  const result = await createUserWithEmailAndPassword(auth, adminAuthEmail(number), code);
  try {
    const inviteSnapshot = await getDoc(doc(db, INVITE_COLLECTION, code));
    const invite = inviteSnapshot.exists() ? inviteSnapshot.data() : null;
    if (!invite || invite.active !== true || invite.role !== "admin" || invite.studentNumber !== number) {
      throw new Error("管理者としての登録権限を確認できませんでした。");
    }
    return result.user;
  } catch (error) {
    await deleteUser(result.user).catch(() => {});
    throw error;
  }
}

export async function loginAccount({ studentNumber, password }) {
  const number = cleanStudentNumber(studentNumber);
  try {
    const data = await callApi("authenticateStudyApp", { studentNumber: number, password });
    if (!data?.token) throw new Error("ログイン情報を確認できませんでした。");
    return (await signInWithCustomToken(auth, data.token)).user;
  } catch (error) {
    if (["unauthenticated", "auth/invalid-credential"].includes(error?.code)) {
      error.userMessage = "学籍番号かパスワードが間違っています。";
    }
    throw error;
  }
}

export async function requestPasswordReset(studentNumber) {
  const number = cleanStudentNumber(studentNumber);
  return callApi("requestStudyAppPasswordReset", { studentNumber: number });
}

export async function resendVerification() {
  if (!auth.currentUser || isAdminAuthEmail(auth.currentUser.email)) throw new Error("このアカウントではメール確認を使用しません。");
  auth.languageCode = "ja";
  await sendEmailVerification(auth.currentUser);
}

export async function refreshVerification() {
  if (!auth.currentUser) return null;
  await reload(auth.currentUser);
  return auth.currentUser;
}

export async function getCurrentProfile() {
  if (!auth.currentUser) return null;
  const snapshot = await getDoc(doc(db, PROFILE_COLLECTION, auth.currentUser.uid));
  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

async function createProfile({ studentNumber, inviteCode = "", role }) {
  const user = auth.currentUser;
  const number = cleanStudentNumber(studentNumber);
  if (!user) throw new Error("ログインしてください。");
  const profileRef = doc(db, PROFILE_COLLECTION, user.uid);
  const numberRef = doc(db, STUDENT_NUMBER_COLLECTION, number);
  const inviteRef = inviteCode ? doc(db, INVITE_COLLECTION, inviteCode) : null;

  await runTransaction(db, async (transaction) => {
    const profileSnapshot = await transaction.get(profileRef);
    if (profileSnapshot.exists()) throw new Error("登録はすでに完了しています。");

    let invite = null;
    if (role === "admin") {
      const inviteSnapshot = await transaction.get(inviteRef);
      if (!inviteSnapshot.exists()) throw new Error("登録権限が無効か、すでに使用されています。");
      invite = inviteSnapshot.data();
      if (invite.active !== true || invite.role !== "admin" || invite.studentNumber !== number) {
        throw new Error("管理者としての登録権限を確認できませんでした。");
      }
    }

    const common = {
      studentNumber: number,
      name: String(invite?.name || "学生"),
      role,
      active: true,
      createdAt: serverTimestamp(),
      verifiedAt: serverTimestamp(),
    };
    const profileData = role === "admin"
      ? { ...common, inviteCode }
      : { ...common, email: user.email.toLowerCase(), emailVerified: true };
    transaction.set(profileRef, profileData);
    transaction.set(numberRef, {
      uid: user.uid,
      studentNumber: number,
      deleted: false,
      createdAt: serverTimestamp(),
    });
    if (inviteRef) transaction.delete(inviteRef);
  });
  return getCurrentProfile();
}

export async function completeStudentRegistration(studentNumber) {
  const user = auth.currentUser;
  if (!user?.email?.endsWith("@sums.ac.jp") || !user.emailVerified) {
    throw new Error("Active!Mailの確認を完了してください。");
  }
  return createProfile({ studentNumber, role: "student" });
}

export async function finishAdminRegistration({ studentNumber, registrationCode, nextPassword }) {
  const user = auth.currentUser;
  const number = cleanStudentNumber(studentNumber);
  if (!user || user.email !== adminAuthEmail(number)) throw new Error("管理者登録を最初からやり直してください。");
  if (String(nextPassword || "").length < 8) throw new Error("新しいパスワードは8文字以上で設定してください。");
  await updatePassword(user, nextPassword);
  return createProfile({ studentNumber: number, inviteCode: String(registrationCode || "").trim(), role: "admin" });
}

export async function discardIncompleteAdminAccount() {
  const user = auth.currentUser;
  if (user && isAdminAuthEmail(user.email) && !(await getCurrentProfile())) {
    await deleteUser(user).catch(() => signOut(auth));
  }
}

export async function changeOwnPassword(currentPassword, nextPassword) {
  if (!auth.currentUser) throw new Error("ログインしてください。");
  return callApi("changeStudyAppPassword", { currentPassword, nextPassword }, { authenticated: true });
}

export async function logout() { await signOut(auth); }

export function authErrorMessage(error) {
  const map = {
    "auth/email-already-in-use": "この学籍番号またはActive!Mailアドレスは登録済みです。ログインしてください。",
    "auth/invalid-credential": "学籍番号かパスワードが間違っています。",
    "unauthenticated": "学籍番号かパスワードが間違っています。",
    "invalid-argument": "入力内容を確認してください。",
    "auth/invalid-email": "入力内容を確認してください。",
    "auth/too-many-requests": "試行回数が多すぎます。しばらく待ってからお試しください。",
    "auth/weak-password": "パスワードは8文字以上で設定してください。",
    "auth/network-request-failed": "通信できませんでした。接続を確認してください。",
    "auth/requires-recent-login": "安全のため、ログインし直してから操作してください。",
    "resource-exhausted": "試行回数が多すぎます。15分後にお試しください。",
    "unavailable": "現在通信できません。少し待ってからお試しください。",
    "permission-denied": "この学籍番号はすでに登録済みか、利用できません。",
  };
  if (error?.userMessage && /[ぁ-んァ-ヶ一-龠]/.test(error.userMessage)) return error.userMessage;
  if (map[error?.code]) return map[error.code];
  if (error?.message && /[ぁ-んァ-ヶ一-龠]/.test(error.message)) return error.message;
  return "処理を完了できませんでした。時間をおいてもう一度お試しください。";
}
