import { auth, db, sumsEmail } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  reload,
  reauthenticateWithCredential,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  EmailAuthProvider,
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

export function authReady() {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (user) => { stop(); resolve(user); });
  });
}

export async function registerAccount({ emailLocal, password }) {
  const email = sumsEmail(emailLocal);
  const result = await createUserWithEmailAndPassword(auth, email, password);
  await sendEmailVerification(result.user);
  return result.user;
}

export async function loginAccount({ emailLocal, password }) {
  return (await signInWithEmailAndPassword(auth, sumsEmail(emailLocal), password)).user;
}

export async function resendVerification() {
  if (!auth.currentUser) throw new Error("ログインしてください。");
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

export async function getInviteRole(inviteCode) {
  const code = String(inviteCode || "").trim();
  if (code.length < 12) return null;
  const snapshot = await getDoc(doc(db, INVITE_COLLECTION, code));
  if (!snapshot.exists() || snapshot.data().active !== true) return null;
  return snapshot.data().role === "admin" ? "admin" : "student";
}

export async function completeRegistration(studentNumber, inviteCode) {
  const user = auth.currentUser;
  if (!user?.email?.endsWith("@sums.ac.jp")) {
    throw new Error("Active!Mailアドレスでログインしてください。");
  }
  const number = String(studentNumber || "").trim();
  const code = String(inviteCode || "").trim();
  if (!/^\d{7}$/.test(number) || code.length < 12) throw new Error("学籍番号または登録コードが正しくありません。");

  const inviteRef = doc(db, INVITE_COLLECTION, code);
  const profileRef = doc(db, PROFILE_COLLECTION, user.uid);
  await runTransaction(db, async (transaction) => {
    const [inviteSnapshot, profileSnapshot] = await Promise.all([
      transaction.get(inviteRef),
      transaction.get(profileRef),
    ]);
    if (profileSnapshot.exists()) throw new Error("登録はすでに完了しています。");
    if (!inviteSnapshot.exists()) throw new Error("登録コードが無効か、すでに使用されています。");
    const invite = inviteSnapshot.data();
    if (invite.active !== true || invite.studentNumber !== number) throw new Error("登録情報が一致しません。");
    if (invite.bootstrap !== true && String(invite.email || "").toLowerCase() !== user.email.toLowerCase()) {
      throw new Error("管理者が登録したActive!Mailアドレスと一致しません。");
    }
    const role = invite.role === "admin" ? "admin" : "student";
    if (role !== "admin" && !user.emailVerified) {
      throw new Error("学生アカウントはActive!Mailの確認を完了してください。");
    }
    transaction.set(profileRef, {
      studentNumber: number,
      name: String(invite.name || "学生"),
      email: user.email.toLowerCase(),
      role,
      active: true,
      inviteCode: code,
      emailVerified: user.emailVerified === true,
      createdAt: serverTimestamp(),
      verifiedAt: serverTimestamp(),
    });
    transaction.delete(inviteRef);
  });
  return getCurrentProfile();
}

export async function changeOwnPassword(currentPassword, nextPassword) {
  const user = auth.currentUser;
  if (!user?.email) throw new Error("ログインしてください。");
  await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, currentPassword));
  await updatePassword(user, nextPassword);
}

export async function logout() { await signOut(auth); }

export function authErrorMessage(error) {
  const map = {
    "auth/email-already-in-use": "このActive!Mailアドレスは登録済みです。ログインしてください。",
    "auth/invalid-credential": "メールアドレスまたはパスワードが違います。",
    "auth/invalid-email": "Active!Mailアドレスを確認してください。",
    "auth/too-many-requests": "試行回数が多すぎます。しばらく待ってからお試しください。",
    "auth/weak-password": "パスワードは8文字以上で設定してください。",
    "auth/network-request-failed": "通信できませんでした。接続を確認してください。",
    "auth/requires-recent-login": "安全のため、ログインし直してから操作してください。",
  };
  return map[error?.code] || error?.message || "処理を完了できませんでした。";
}
