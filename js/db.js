// js/db.js — All Firestore read/write operations for BudgetBudy
//
// Firestore data model:
//   /users/{uid}/settings/main        — bank balance snapshot + currency
//   /users/{uid}/incomeSources/{id}   — salary, vouchers, rent etc.
//   /users/{uid}/transactions/{id}    — all financial operations
//   /users/{uid}/fixedExpenses/{id}   — recurring monthly costs (with paidMonth + items[])
//   /users/{uid}/categories/{id}      — income/expense categories
//   /users/{uid}/projects/{id}        — budget projects (isAllocation flag + embedded items[])

import { db } from "./firebase.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

// ─── CACHE HELPERS ────────────────────────────────────────────
const PREFIX = "budgetbudy:";

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { data, ts, ttl } = JSON.parse(raw);
    if (ttl && Date.now() - ts > ttl) {
      localStorage.removeItem(PREFIX + key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function cacheSet(key, data, ttl = 0) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ data, ts: Date.now(), ttl }));
  } catch { /* ignore quota errors */ }
}

function cacheBust(...keys) {
  for (const k of keys) localStorage.removeItem(PREFIX + k);
}

// ─── COLLECTION REFERENCES ────────────────────────────────────
const col = (uid, name) => collection(db, "users", uid, name);
const docR = (uid, colName, id) => doc(db, "users", uid, colName, id);

// ─── SETTINGS (bank balance snapshot) ────────────────────────
export async function getSettings(uid) {
  const cached = cacheGet(uid + ":settings");
  if (cached) return cached;
  try {
    const snap = await getDoc(doc(db, "users", uid, "settings", "main"));
    const data = snap.exists() ? snap.data() : { totalBalance: 0, currency: "€", balanceDate: "" };
    cacheSet(uid + ":settings", data);
    return data;
  } catch {
    return { totalBalance: 0, currency: "€", balanceDate: "" };
  }
}

export async function updateSettings(uid, data) {
  await setDoc(doc(db, "users", uid, "settings", "main"), data, { merge: true });
  cacheBust(uid + ":settings");
}

// ─── INCOME SOURCES ───────────────────────────────────────────
export async function getIncomeSources(uid) {
  const cached = cacheGet(uid + ":incomeSources");
  if (cached) return cached;
  const snap = await getDocs(col(uid, "incomeSources"));
  const data = snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
  cacheSet(uid + ":incomeSources", data);
  return data;
}

export async function addIncomeSource(uid, data) {
  const ref = await addDoc(col(uid, "incomeSources"), { ...data, createdAt: new Date().toISOString() });
  cacheBust(uid + ":incomeSources");
  return ref.id;
}

export async function updateIncomeSource(uid, id, data) {
  await updateDoc(docR(uid, "incomeSources", id), data);
  cacheBust(uid + ":incomeSources");
}

export async function deleteIncomeSource(uid, id) {
  await deleteDoc(docR(uid, "incomeSources", id));
  cacheBust(uid + ":incomeSources");
}

// ─── TRANSACTIONS ─────────────────────────────────────────────
export async function getTransactions(uid) {
  const cached = cacheGet(uid + ":transactions");
  if (cached) return cached;
  const snap = await getDocs(query(col(uid, "transactions"), orderBy("date", "desc")));
  const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  cacheSet(uid + ":transactions", data);
  return data;
}

export async function addTransaction(uid, data) {
  const ref = await addDoc(col(uid, "transactions"), {
    ...data,
    createdAt: new Date().toISOString(),
  });
  cacheBust(uid + ":transactions");
  return ref.id;
}

export async function updateTransaction(uid, id, data) {
  await updateDoc(docR(uid, "transactions", id), {
    ...data,
    updatedAt: new Date().toISOString(),
  });
  cacheBust(uid + ":transactions");
}

export async function deleteTransaction(uid, id) {
  await deleteDoc(docR(uid, "transactions", id));
  cacheBust(uid + ":transactions");
}

// ─── FIXED EXPENSES ───────────────────────────────────────────
export async function getFixedExpenses(uid) {
  const cached = cacheGet(uid + ":fixed");
  if (cached) return cached;
  const snap = await getDocs(col(uid, "fixedExpenses"));
  const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  cacheSet(uid + ":fixed", data);
  return data;
}

export async function addFixedExpense(uid, data) {
  const ref = await addDoc(col(uid, "fixedExpenses"), {
    ...data,
    createdAt: new Date().toISOString(),
  });
  cacheBust(uid + ":fixed");
  return ref.id;
}

export async function updateFixedExpense(uid, id, data) {
  await updateDoc(docR(uid, "fixedExpenses", id), data);
  cacheBust(uid + ":fixed");
}

export async function deleteFixedExpense(uid, id) {
  await deleteDoc(docR(uid, "fixedExpenses", id));
  cacheBust(uid + ":fixed");
}

// ─── CATEGORIES ───────────────────────────────────────────────
export async function getCategories(uid) {
  const cached = cacheGet(uid + ":categories");
  if (cached) return cached;
  const snap = await getDocs(col(uid, "categories"));
  const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  cacheSet(uid + ":categories", data);
  return data;
}

export async function addCategory(uid, data) {
  const ref = await addDoc(col(uid, "categories"), {
    ...data,
    createdAt: new Date().toISOString(),
  });
  cacheBust(uid + ":categories");
  return ref.id;
}

export async function updateCategory(uid, id, data) {
  await updateDoc(docR(uid, "categories", id), data);
  cacheBust(uid + ":categories");
}

export async function deleteCategory(uid, id) {
  await deleteDoc(docR(uid, "categories", id));
  cacheBust(uid + ":categories");
}

// ─── PROJECTS ─────────────────────────────────────────────────
// Projects store items as an embedded array inside the document.
// This avoids extra subcollection queries and keeps the model simple.

export async function getProjects(uid) {
  const cached = cacheGet(uid + ":projects");
  if (cached) return cached;
  const snap = await getDocs(col(uid, "projects"));
  const data = snap.docs.map(d => ({
    id: d.id,
    ...d.data(),
    items: d.data().items || [],
  }));
  cacheSet(uid + ":projects", data);
  return data;
}

export async function addProject(uid, data) {
  const ref = await addDoc(col(uid, "projects"), {
    ...data,
    items: [],
    createdAt: new Date().toISOString(),
  });
  cacheBust(uid + ":projects");
  return ref.id;
}

export async function updateProject(uid, id, data) {
  await updateDoc(docR(uid, "projects", id), data);
  cacheBust(uid + ":projects");
}

export async function deleteProject(uid, id) {
  await deleteDoc(docR(uid, "projects", id));
  cacheBust(uid + ":projects");
}

// Project items are stored as an embedded array; we pass the full updated array
export async function updateProjectItems(uid, projectId, items) {
  await updateDoc(docR(uid, "projects", projectId), { items });
  cacheBust(uid + ":projects");
}
