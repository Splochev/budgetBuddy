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

// ─── COLLECTION REFERENCES ────────────────────────────────────
const col = (uid, name) => collection(db, "users", uid, name);
const docR = (uid, colName, id) => doc(db, "users", uid, colName, id);

// ─── SETTINGS (bank balance snapshot) ────────────────────────
export async function getSettings(uid) {
  try {
    const snap = await getDoc(doc(db, "users", uid, "settings", "main"));
    return snap.exists() ? snap.data() : { totalBalance: 0, currency: "€", balanceDate: "" };
  } catch {
    return { totalBalance: 0, currency: "€", balanceDate: "" };
  }
}

export async function updateSettings(uid, data) {
  await setDoc(doc(db, "users", uid, "settings", "main"), data, { merge: true });
}

// ─── INCOME SOURCES ───────────────────────────────────────────
export async function getIncomeSources(uid) {
  const snap = await getDocs(col(uid, "incomeSources"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order || 0) - (b.order || 0));
}

export async function addIncomeSource(uid, data) {
  const ref = await addDoc(col(uid, "incomeSources"), { ...data, createdAt: new Date().toISOString() });
  return ref.id;
}

export async function updateIncomeSource(uid, id, data) {
  await updateDoc(docR(uid, "incomeSources", id), data);
}

export async function deleteIncomeSource(uid, id) {
  await deleteDoc(docR(uid, "incomeSources", id));
}

// ─── TRANSACTIONS ─────────────────────────────────────────────
export async function getTransactions(uid) {
  const snap = await getDocs(query(col(uid, "transactions"), orderBy("date", "desc")));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addTransaction(uid, data) {
  const ref = await addDoc(col(uid, "transactions"), {
    ...data,
    createdAt: new Date().toISOString(),
  });
  return ref.id;
}

export async function updateTransaction(uid, id, data) {
  await updateDoc(docR(uid, "transactions", id), {
    ...data,
    updatedAt: new Date().toISOString(),
  });
}

export async function deleteTransaction(uid, id) {
  await deleteDoc(docR(uid, "transactions", id));
}

// ─── FIXED EXPENSES ───────────────────────────────────────────
export async function getFixedExpenses(uid) {
  const snap = await getDocs(col(uid, "fixedExpenses"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addFixedExpense(uid, data) {
  const ref = await addDoc(col(uid, "fixedExpenses"), {
    ...data,
    createdAt: new Date().toISOString(),
  });
  return ref.id;
}

export async function updateFixedExpense(uid, id, data) {
  await updateDoc(docR(uid, "fixedExpenses", id), data);
}

export async function deleteFixedExpense(uid, id) {
  await deleteDoc(docR(uid, "fixedExpenses", id));
}

// ─── CATEGORIES ───────────────────────────────────────────────
export async function getCategories(uid) {
  const snap = await getDocs(col(uid, "categories"));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addCategory(uid, data) {
  const ref = await addDoc(col(uid, "categories"), {
    ...data,
    createdAt: new Date().toISOString(),
  });
  return ref.id;
}

export async function updateCategory(uid, id, data) {
  await updateDoc(docR(uid, "categories", id), data);
}

export async function deleteCategory(uid, id) {
  await deleteDoc(docR(uid, "categories", id));
}

// ─── PROJECTS ─────────────────────────────────────────────────
// Projects store items as an embedded array inside the document.
// This avoids extra subcollection queries and keeps the model simple.

export async function getProjects(uid) {
  const snap = await getDocs(col(uid, "projects"));
  return snap.docs.map(d => ({
    id: d.id,
    ...d.data(),
    items: d.data().items || [],
  }));
}

export async function addProject(uid, data) {
  const ref = await addDoc(col(uid, "projects"), {
    ...data,
    items: [],
    createdAt: new Date().toISOString(),
  });
  return ref.id;
}

export async function updateProject(uid, id, data) {
  await updateDoc(docR(uid, "projects", id), data);
}

export async function deleteProject(uid, id) {
  await deleteDoc(docR(uid, "projects", id));
}

// Project items are stored as an embedded array; we pass the full updated array
export async function updateProjectItems(uid, projectId, items) {
  await updateDoc(docR(uid, "projects", projectId), { items });
}
