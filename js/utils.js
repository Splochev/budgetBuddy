// js/utils.js — Shared utilities for BudgetBudy

// ─── ID GENERATION ────────────────────────────────────────────
export function generateId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ─── DEBOUNCE ─────────────────────────────────────────────────
export function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ─── DATE HELPERS ─────────────────────────────────────────────
export function todayStr() {
  return new Date().toISOString().split("T")[0];
}

export function currentMonthStr() {
  return new Date().toISOString().slice(0, 7);
}

export function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`;
}

export function formatMonthYear(monthStr) {
  if (!monthStr) return "";
  const [year, month] = monthStr.split("-").map(Number);
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return `${months[month - 1]} ${year}`;
}

export function monthsBack(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 7);
}

// ─── NUMBER HELPERS ───────────────────────────────────────────
export function round2(n) {
  return Math.round((n || 0) * 100) / 100;
}

export function fmtNum(n) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0);
}

export function fmtCurrency(n, symbol = "лв") {
  return fmtNum(n) + " " + symbol;
}

// ─── HTML ESCAPE ──────────────────────────────────────────────
export function escHTML(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─── COLOR HELPERS ────────────────────────────────────────────
export const CATEGORY_COLORS = [
  "#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#ec4899", "#f97316", "#84cc16", "#14b8a6",
  "#6366f1", "#a855f7", "#e11d48", "#0ea5e9", "#d97706",
];

// ─── MONTH LIST ───────────────────────────────────────────────
export function lastNMonths(n = 12) {
  const months = [];
  for (let i = 0; i < n; i++) {
    months.push(monthsBack(i));
  }
  return months;
}
