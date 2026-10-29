import { initializeApp } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.2.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAEtS2NGZKqHFh29kmR9OjEpshbC1yvjFY",
  authDomain: "universitynotifier-67517.firebaseapp.com",
  projectId: "universitynotifier-67517",
  storageBucket: "universitynotifier-67517.firebasestorage.app",
  messagingSenderId: "908622250178",
  appId: "1:908622250178:web:3e355fce8698fcf179bb5b",
};

export const firebaseApp = initializeApp(firebaseConfig, "caremate-test");
export const auth = getAuth(firebaseApp);
export const db = getFirestore(firebaseApp);
export const SUMS_DOMAIN = "sums.ac.jp";
export function sumsEmail(localPart) {
  const local = String(localPart || "").trim().toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,80}$/.test(local) || local.includes("..")) {
    throw new Error("Active!Mailアドレスの@より前を正しく入力してください。");
  }
  return `${local}@${SUMS_DOMAIN}`;
}
