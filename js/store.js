// js/store.js — Alpine.js global store for BudgetBudy
//
// Net money formula:
//   freeBalance = totalBalance - unpaidObligations - projectAllocations
//
// Register with: registerStore(Alpine) before Alpine.start()

import { auth } from "./firebase.js";
import * as DB from "./db.js";
import { translations } from "./i18n.js";
import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js";
import {
  todayStr,
  currentMonthStr,
  formatDate,
  formatMonthYear,
  fmtNum,
  generateId,
  lastNMonths,
} from "./utils.js";

export function registerStore(Alpine) {
  Alpine.store("budget", {
    // ── AUTH ──────────────────────────────────────────────────
    user: null,
    loading: true,

    // ── UI ────────────────────────────────────────────────────
    sidebarOpen: window.innerWidth >= 769,
    activeView: "dashboard",
    modal: null,
    saving: false,
    toasts: [],

    // ── DATA ──────────────────────────────────────────────────
    settings: { totalBalance: 0, currency: "€", balanceDate: "" },
    incomeSources: [],
    transactions: [],
    fixedExpenses: [],
    categories: [],
    projects: [],
    activeProjectId: null,

    // ── FILTERS ───────────────────────────────────────────────
    filterMonth: currentMonthStr(),
    filterType: "",
    filterCategory: "",
    searchQ: "",

    // ── FORMS ─────────────────────────────────────────────────
    txForm: { date: "", amount: "", type: "expense", categoryId: "", description: "" },
    fixedForm: { name: "", amount: "", type: "other", active: true, linkedCategoryId: "" },
    billItemForm: { name: "", amount: "" },
    catForm: { name: "", type: "expense", color: "#22c55e" },
    projectForm: { name: "", totalBudget: "", date: "", description: "", isAllocation: false },
    projectItemForm: { category: "", budgeted: "", spent: "0", notes: "" },
    incomeSourceForm: { name: "", amount: "", active: true },
    balanceForm: { totalBalance: "", currency: "€", balanceDate: "" },
    editingId: null,
    editingFixedId: null,   // which fixed expense we're editing a bill item inside
    formError: "",

    // ── i18n ──────────────────────────────────────────────────
    lang: localStorage.getItem("budgetbudy-lang") || "en",
    t(key) {
      const tr = translations[this.lang] ?? translations.en;
      return (tr[key] ?? translations.en[key]) ?? key;
    },
    setLang(code) {
      this.lang = code;
      localStorage.setItem("budgetbudy-lang", code);
    },

    // ── COMPUTED: BALANCE ─────────────────────────────────────
    get totalBalance() {
      return this.settings.totalBalance || 0;
    },

    get currency() {
      return this.settings.currency || "€";
    },

    // Unpaid obligations = all active fixed expenses not yet paid this month
    // · bills type   → sum of individual bill items not yet toggled
    // · linkedCategoryId set → budget minus transactions tagged with that category this month (spending limit)
    // · others       → full amount if paidMonth toggle not set
    get unpaidObligations() {
      const m = currentMonthStr();
      let total = 0;
      for (const f of this.fixedExpenses) {
        if (!f.active) continue;
        if (f.type === "bills" && f.items && f.items.length > 0) {
          for (const item of f.items) {
            if (item.paidMonth !== m) total += (item.amount || 0);
          }
        } else if (f.linkedCategoryId) {
          // Category-tracked: remaining = budget - already spent this month
          total += this.fixedCategoryRemaining(f);
        } else {
          if (f.paidMonth !== m) total += (f.amount || 0);
        }
      }
      return total;
    },

    // Locked allocations = remaining budget of all isAllocation projects
    get projectAllocations() {
      return this.projects
        .filter(p => p.isAllocation)
        .reduce((sum, p) => {
          const budget = p.totalBudget || this.projectTotalBudgeted(p);
          const spent = this.projectTotalSpent(p);
          return sum + Math.max(0, budget - spent);
        }, 0);
    },

    // The core metric the user wants to see
    get freeBalance() {
      return this.totalBalance - this.unpaidObligations - this.projectAllocations - this.monthlyExpenses;
    },

    // ── COMPUTED: MONTHLY ─────────────────────────────────────
    get monthlyIncomeTotal() {
      return this.incomeSources.filter(s => s.active).reduce((s, i) => s + (i.amount || 0), 0);
    },

    get monthlyFixedTotal() {
      return this.fixedExpenses.filter(f => f.active).reduce((s, f) => s + (f.amount || 0), 0);
    },

    get netMonthly() {
      return this.monthlyIncomeTotal - this.monthlyFixedTotal;
    },

    get monthlyIncome() {
      return this.transactions
        .filter(t => t.type === "income" && (t.date || "").startsWith(this.filterMonth))
        .reduce((s, t) => s + (t.amount || 0), 0);
    },

    get monthlyExpenses() {
      return this.transactions
        .filter(t => t.type === "expense" && (t.date || "").startsWith(this.filterMonth))
        .reduce((s, t) => s + (t.amount || 0), 0);
    },

    // Unpaid this month detail for dashboard breakdown
    get unpaidDetail() {
      const m = currentMonthStr();
      const items = [];
      for (const f of this.fixedExpenses) {
        if (!f.active) continue;
        if (f.type === "bills" && f.items && f.items.length > 0) {
          const unpaidAmt = f.items.filter(i => i.paidMonth !== m).reduce((s, i) => s + (i.amount || 0), 0);
          if (unpaidAmt > 0) items.push({ name: f.name, amount: unpaidAmt, fixedId: f.id, type: "bills" });
        } else if (f.linkedCategoryId) {
          const remaining = this.fixedCategoryRemaining(f);
          const spent = this.fixedCategorySpent(f);
          if (remaining > 0 || spent > 0) {
            items.push({
              name: f.name,
              amount: remaining,
              fixedId: f.id,
              type: "category",
              spent,
              budget: f.amount || 0,
            });
          }
        } else {
          if (f.paidMonth !== m) items.push({ name: f.name, amount: f.amount || 0, fixedId: f.id, type: f.type });
        }
      }
      return items;
    },

    // Allocation detail for dashboard breakdown
    get allocationDetail() {
      return this.projects
        .filter(p => p.isAllocation)
        .map(p => ({
          name: p.name,
          amount: Math.max(0, (p.totalBudget || this.projectTotalBudgeted(p)) - this.projectTotalSpent(p)),
          projectId: p.id,
        }));
    },

    // ── COMPUTED: TRANSACTIONS ────────────────────────────────
    get filteredTransactions() {
      return this.transactions
        .filter(t => {
          if (this.filterMonth && !(t.date || "").startsWith(this.filterMonth)) return false;
          if (this.filterType && t.type !== this.filterType) return false;
          if (this.filterCategory && t.categoryId !== this.filterCategory) return false;
          if (this.searchQ) {
            const q = this.searchQ.toLowerCase();
            return (t.description || "").toLowerCase().includes(q) ||
                   this.catName(t.categoryId).toLowerCase().includes(q);
          }
          return true;
        })
        .sort((a, b) => {
          const dc = (b.date || "").localeCompare(a.date || "");
          return dc !== 0 ? dc : (b.createdAt || "").localeCompare(a.createdAt || "");
        });
    },

    get recentTransactions() {
      return [...this.transactions]
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
        .slice(0, 6);
    },

    get categorySpending() {
      const map = {};
      this.transactions
        .filter(t => t.type === "expense" && (t.date || "").startsWith(this.filterMonth))
        .forEach(t => {
          const key = t.categoryId || "__none__";
          map[key] = (map[key] || 0) + (t.amount || 0);
        });
      const total = Object.values(map).reduce((s, v) => s + v, 0);
      return Object.entries(map)
        .map(([catId, amount]) => ({
          catId, amount,
          name: catId === "__none__" ? this.t("uncategorized") : this.catName(catId),
          color: catId === "__none__" ? "var(--text3)" : this.catColor(catId),
          pct: total > 0 ? Math.round((amount / total) * 100) : 0,
        }))
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 8);
    },

    // ── COMPUTED: PROJECTS ────────────────────────────────────
    get activeProject() {
      return this.projects.find(p => p.id === this.activeProjectId) || null;
    },

    get incomeCategories() {
      return this.categories.filter(c => c.type === "income" || c.type === "both");
    },

    get expenseCategories() {
      return this.categories.filter(c => c.type === "expense" || c.type === "both");
    },

    get txCategories() {
      return this.txForm.type === "income" ? this.incomeCategories : this.expenseCategories;
    },

    get monthOptions() {
      return lastNMonths(24);
    },

    // ── HELPERS ──────────────────────────────────────────────
    catName(catId) {
      if (!catId) return this.t("uncategorized");
      return this.categories.find(c => c.id === catId)?.name || this.t("uncategorized");
    },

    catColor(catId) {
      if (!catId) return "var(--text3)";
      return this.categories.find(c => c.id === catId)?.color || "var(--text3)";
    },

    fmt(n) { return fmtNum(n); },

    fmtC(n) { return fmtNum(n) + " " + this.currency; },

    fmtDate(d) { return formatDate(d); },

    fmtMonthYear(m) { return formatMonthYear(m); },

    isFixedPaidThisMonth(f) {
      return f.paidMonth === currentMonthStr();
    },

    isBillItemPaidThisMonth(item) {
      return item.paidMonth === currentMonthStr();
    },

    // How much has been spent this month on transactions tagged with the linked category
    fixedCategorySpent(f) {
      if (!f.linkedCategoryId) return 0;
      const m = currentMonthStr();
      return this.transactions
        .filter(t => t.type === "expense" && t.categoryId === f.linkedCategoryId && (t.date || "").startsWith(m))
        .reduce((s, t) => s + (t.amount || 0), 0);
    },

    // How much of the budget is still unspent this month
    fixedCategoryRemaining(f) {
      return Math.max(0, (f.amount || 0) - this.fixedCategorySpent(f));
    },

    // Progress percentage (0–100) of a category-tracked budget
    fixedCategoryPct(f) {
      if (!f.amount) return 0;
      return Math.min(100, Math.round((this.fixedCategorySpent(f) / f.amount) * 100));
    },

    fixedUnpaidAmount(f) {
      const m = currentMonthStr();
      if (f.type === "bills" && f.items && f.items.length > 0) {
        return f.items.filter(i => i.paidMonth !== m).reduce((s, i) => s + (i.amount || 0), 0);
      }
      if (f.linkedCategoryId) return this.fixedCategoryRemaining(f);
      return f.paidMonth === m ? 0 : (f.amount || 0);
    },

    fixedPaidAmount(f) {
      return (f.amount || 0) - this.fixedUnpaidAmount(f);
    },

    projectTotalBudgeted(project) {
      return (project.items || []).reduce((s, i) => s + (i.budgeted || 0), 0);
    },

    projectTotalSpent(project) {
      return (project.items || []).reduce((s, i) => s + (i.spent || 0), 0);
    },

    projectRemaining(project) {
      const budget = project.totalBudget || this.projectTotalBudgeted(project);
      return budget - this.projectTotalSpent(project);
    },

    projectProgress(project) {
      const budget = project.totalBudget || this.projectTotalBudgeted(project);
      if (!budget) return 0;
      return Math.min(100, Math.round((this.projectTotalSpent(project) / budget) * 100));
    },

    // ── INIT ──────────────────────────────────────────────────
    init() {
      onAuthStateChanged(auth, async (user) => {
        if (user) {
          this.user = user;
          await this.loadData();
          this.loading = false;
        } else {
          window.location.href = "./index.html";
        }
      });
    },

    async loadData() {
      const uid = this.user.uid;
      console.log("🔑 BudgetBudy loading for UID:", uid, "| email:", this.user.email);
      const [settings, incomeSources, transactions, fixedExpenses, categories, projects] = await Promise.all([
        DB.getSettings(uid),
        DB.getIncomeSources(uid),
        DB.getTransactions(uid),
        DB.getFixedExpenses(uid),
        DB.getCategories(uid),
        DB.getProjects(uid),
      ]);
      console.log("📦 Loaded:", { settings, incomeSources: incomeSources.length, fixedExpenses: fixedExpenses.length, categories: categories.length, projects: projects.length, transactions: transactions.length });
      this.settings      = settings;
      this.incomeSources = incomeSources;
      this.transactions  = transactions;
      this.fixedExpenses = fixedExpenses.sort((a, b) => (a.order || 0) - (b.order || 0));
      this.categories    = categories;
      this.projects      = projects;
      if (!this.activeProjectId && projects.length > 0) {
        this.activeProjectId = projects[0].id;
      }
    },

    // ── TOAST ────────────────────────────────────────────────
    toast(msg, type = "success") {
      const id = generateId();
      this.toasts = [...this.toasts, { id, msg, type }];
      setTimeout(() => { this.toasts = this.toasts.filter(t => t.id !== id); }, 3500);
    },

    // ── NAVIGATION ───────────────────────────────────────────
    navigate(view) {
      this.activeView = view;
      this.formError = "";
      if (window.innerWidth < 769) this.sidebarOpen = false;
    },

    closeModal() {
      this.modal = null;
      this.formError = "";
      this.editingId = null;
      this.editingFixedId = null;
    },

    // ── LOGOUT ───────────────────────────────────────────────
    async logout() {
      await signOut(auth);
    },

    // ════════════════════════════════════════════════════════
    // SETTINGS (bank balance)
    // ════════════════════════════════════════════════════════
    openEditBalance() {
      this.balanceForm = {
        totalBalance: String(this.settings.totalBalance || ""),
        currency: this.settings.currency || "€",
        balanceDate: this.settings.balanceDate || todayStr(),
      };
      this.formError = "";
      this.modal = "balance";
    },

    async saveBalance() {
      const val = parseFloat(this.balanceForm.totalBalance);
      if (isNaN(val)) { this.formError = this.t("error_fill_fields"); return; }
      this.saving = true;
      try {
        const data = {
          totalBalance: val,
          currency: this.balanceForm.currency || "€",
          balanceDate: this.balanceForm.balanceDate || todayStr(),
        };
        await DB.updateSettings(this.user.uid, data);
        this.settings = { ...this.settings, ...data };
        this.closeModal();
        this.toast(this.t("toast_saved"));
      } catch (e) {
        this.formError = this.t("error_generic");
      } finally {
        this.saving = false;
      }
    },

    // ════════════════════════════════════════════════════════
    // INCOME SOURCES
    // ════════════════════════════════════════════════════════
    openAddIncomeSource() {
      this.editingId = null;
      this.formError = "";
      this.incomeSourceForm = { name: "", amount: "", active: true };
      this.modal = "incomeSource";
    },

    openEditIncomeSource(s) {
      this.editingId = s.id;
      this.formError = "";
      this.incomeSourceForm = { name: s.name || "", amount: String(s.amount || ""), active: s.active !== false };
      this.modal = "incomeSource";
    },

    async saveIncomeSource() {
      const amount = parseFloat(this.incomeSourceForm.amount);
      if (!this.incomeSourceForm.name.trim() || !amount) {
        this.formError = this.t("error_fill_fields"); return;
      }
      this.saving = true;
      try {
        const data = { name: this.incomeSourceForm.name.trim(), amount, active: this.incomeSourceForm.active };
        if (this.editingId) {
          await DB.updateIncomeSource(this.user.uid, this.editingId, data);
          this.incomeSources = this.incomeSources.map(s => s.id === this.editingId ? { ...s, ...data } : s);
        } else {
          const id = await DB.addIncomeSource(this.user.uid, data);
          this.incomeSources = [...this.incomeSources, { id, ...data }];
        }
        this.closeModal();
        this.toast(this.t("toast_saved"));
      } catch (e) {
        this.formError = this.t("error_generic");
      } finally {
        this.saving = false;
      }
    },

    async deleteIncomeSource(id) {
      if (!confirm(this.t("confirm_delete"))) return;
      try {
        await DB.deleteIncomeSource(this.user.uid, id);
        this.incomeSources = this.incomeSources.filter(s => s.id !== id);
        this.toast(this.t("toast_deleted"));
      } catch (e) {
        this.toast(this.t("error_generic"), "error");
      }
    },

    // ════════════════════════════════════════════════════════
    // TRANSACTIONS
    // ════════════════════════════════════════════════════════
    openAddTransaction(type = "expense") {
      this.editingId = null;
      this.formError = "";
      this.txForm = { date: todayStr(), amount: "", type, categoryId: "", description: "" };
      this.modal = "transaction";
    },

    openEditTransaction(tx) {
      this.editingId = tx.id;
      this.formError = "";
      this.txForm = {
        date: tx.date || todayStr(),
        amount: String(tx.amount || ""),
        type: tx.type || "expense",
        categoryId: tx.categoryId || "",
        description: tx.description || "",
      };
      this.modal = "transaction";
    },

    async saveTransaction() {
      const amount = parseFloat(this.txForm.amount);
      if (!this.txForm.date || !amount || amount <= 0) {
        this.formError = this.t("error_fill_fields"); return;
      }
      this.formError = "";
      this.saving = true;
      try {
        const data = {
          date: this.txForm.date,
          amount,
          type: this.txForm.type,
          categoryId: this.txForm.categoryId || null,
          description: this.txForm.description.trim(),
        };
        if (this.editingId) {
          await DB.updateTransaction(this.user.uid, this.editingId, data);
          this.transactions = this.transactions.map(t => t.id === this.editingId ? { ...t, ...data } : t);
          this.toast(this.t("toast_transaction_updated"));
        } else {
          const id = await DB.addTransaction(this.user.uid, data);
          this.transactions = [{ id, ...data, createdAt: new Date().toISOString() }, ...this.transactions];
          this.toast(this.t("toast_transaction_added"));
        }
        this.closeModal();
      } catch (e) {
        this.formError = this.t("error_generic");
      } finally {
        this.saving = false;
      }
    },

    async deleteTransaction(id) {
      if (!confirm(this.t("confirm_delete"))) return;
      try {
        await DB.deleteTransaction(this.user.uid, id);
        this.transactions = this.transactions.filter(t => t.id !== id);
        this.toast(this.t("toast_deleted"));
      } catch (e) {
        this.toast(this.t("error_generic"), "error");
      }
    },

    // ════════════════════════════════════════════════════════
    // FIXED EXPENSES + MONTHLY PAYMENT TRACKING
    // ════════════════════════════════════════════════════════
    openAddFixed() {
      this.editingId = null;
      this.formError = "";
      this.fixedForm = { name: "", amount: "", type: "other", active: true, linkedCategoryId: "" };
      this.modal = "fixed";
    },

    openEditFixed(f) {
      this.editingId = f.id;
      this.formError = "";
      this.fixedForm = {
        name: f.name || "",
        amount: String(f.amount || ""),
        type: f.type || "other",
        active: f.active !== false,
        linkedCategoryId: f.linkedCategoryId || "",
      };
      this.modal = "fixed";
    },

    async saveFixed() {
      const amount = parseFloat(this.fixedForm.amount);
      if (!this.fixedForm.name.trim() || !amount || amount <= 0) {
        this.formError = this.t("error_fill_fields"); return;
      }
      this.formError = "";
      this.saving = true;
      try {
        const data = {
          name: this.fixedForm.name.trim(),
          amount,
          type: this.fixedForm.type,
          active: this.fixedForm.active,
          linkedCategoryId: this.fixedForm.linkedCategoryId || null,
        };
        if (this.editingId) {
          await DB.updateFixedExpense(this.user.uid, this.editingId, data);
          this.fixedExpenses = this.fixedExpenses.map(f => f.id === this.editingId ? { ...f, ...data } : f);
          this.toast(this.t("toast_fixed_updated"));
        } else {
          const id = await DB.addFixedExpense(this.user.uid, { ...data, paidMonth: null, items: [] });
          this.fixedExpenses = [...this.fixedExpenses, { id, ...data, paidMonth: null, items: [] }];
          this.toast(this.t("toast_fixed_added"));
        }
        this.closeModal();
      } catch (e) {
        this.formError = this.t("error_generic");
      } finally {
        this.saving = false;
      }
    },

    // Toggle whole fixed expense paid/unpaid (for credits, food, investments)
    async toggleFixedPaid(id) {
      const f = this.fixedExpenses.find(x => x.id === id);
      if (!f) return;
      const m = currentMonthStr();
      const paidMonth = f.paidMonth === m ? null : m;
      try {
        await DB.updateFixedExpense(this.user.uid, id, { paidMonth });
        this.fixedExpenses = this.fixedExpenses.map(x => x.id === id ? { ...x, paidMonth } : x);
        this.toast(paidMonth ? "Marked as paid ✓" : "Marked as unpaid");
      } catch (e) {
        this.toast(this.t("error_generic"), "error");
      }
    },

    // Toggle individual bill item paid/unpaid
    async toggleBillItem(fixedId, itemId) {
      const f = this.fixedExpenses.find(x => x.id === fixedId);
      if (!f) return;
      const m = currentMonthStr();
      const newItems = (f.items || []).map(i => {
        if (i.id !== itemId) return i;
        return { ...i, paidMonth: i.paidMonth === m ? null : m };
      });
      try {
        await DB.updateFixedExpense(this.user.uid, fixedId, { items: newItems });
        this.fixedExpenses = this.fixedExpenses.map(x => x.id === fixedId ? { ...x, items: newItems } : x);
      } catch (e) {
        this.toast(this.t("error_generic"), "error");
      }
    },

    // ── Bill sub-item CRUD ────────────────────────────────────
    openAddBillItem(fixedId) {
      this.editingFixedId = fixedId;
      this.editingId = null;
      this.formError = "";
      this.billItemForm = { name: "", amount: "" };
      this.modal = "billItem";
    },

    openEditBillItem(fixedId, item) {
      this.editingFixedId = fixedId;
      this.editingId = item.id;
      this.formError = "";
      this.billItemForm = { name: item.name || "", amount: String(item.amount || "") };
      this.modal = "billItem";
    },

    async saveBillItem() {
      const amount = parseFloat(this.billItemForm.amount);
      if (!this.billItemForm.name.trim() || !amount) {
        this.formError = this.t("error_fill_fields"); return;
      }
      const fid = this.editingFixedId;
      const f = this.fixedExpenses.find(x => x.id === fid);
      if (!f) return;
      this.saving = true;
      try {
        let newItems;
        if (this.editingId) {
          newItems = (f.items || []).map(i => i.id === this.editingId
            ? { ...i, name: this.billItemForm.name.trim(), amount }
            : i);
        } else {
          newItems = [...(f.items || []), { id: generateId(), name: this.billItemForm.name.trim(), amount, paidMonth: null }];
        }
        const newTotal = newItems.reduce((s, i) => s + (i.amount || 0), 0);
        await DB.updateFixedExpense(this.user.uid, fid, { items: newItems, amount: newTotal });
        this.fixedExpenses = this.fixedExpenses.map(x => x.id === fid ? { ...x, items: newItems, amount: newTotal } : x);
        this.closeModal();
        this.toast(this.t("toast_saved"));
      } catch (e) {
        this.formError = this.t("error_generic");
      } finally {
        this.saving = false;
      }
    },

    async deleteBillItem(fixedId, itemId) {
      if (!confirm(this.t("confirm_delete"))) return;
      const f = this.fixedExpenses.find(x => x.id === fixedId);
      if (!f) return;
      const newItems = (f.items || []).filter(i => i.id !== itemId);
      const newTotal = newItems.reduce((s, i) => s + (i.amount || 0), 0);
      try {
        await DB.updateFixedExpense(this.user.uid, fixedId, { items: newItems, amount: newTotal });
        this.fixedExpenses = this.fixedExpenses.map(x => x.id === fixedId ? { ...x, items: newItems, amount: newTotal } : x);
        this.toast(this.t("toast_deleted"));
      } catch (e) {
        this.toast(this.t("error_generic"), "error");
      }
    },

    async toggleFixed(id) {
      const f = this.fixedExpenses.find(x => x.id === id);
      if (!f) return;
      const active = !f.active;
      try {
        await DB.updateFixedExpense(this.user.uid, id, { active });
        this.fixedExpenses = this.fixedExpenses.map(x => x.id === id ? { ...x, active } : x);
      } catch (e) {
        this.toast(this.t("error_generic"), "error");
      }
    },

    async deleteFixed(id) {
      if (!confirm(this.t("confirm_delete"))) return;
      try {
        await DB.deleteFixedExpense(this.user.uid, id);
        this.fixedExpenses = this.fixedExpenses.filter(f => f.id !== id);
        this.toast(this.t("toast_deleted"));
      } catch (e) {
        this.toast(this.t("error_generic"), "error");
      }
    },

    // ════════════════════════════════════════════════════════
    // CATEGORIES
    // ════════════════════════════════════════════════════════
    openAddCategory(type = "expense") {
      this.editingId = null;
      this.formError = "";
      this.catForm = { name: "", type, color: "#22c55e" };
      this.modal = "category";
    },

    openEditCategory(c) {
      this.editingId = c.id;
      this.formError = "";
      this.catForm = { name: c.name || "", type: c.type || "expense", color: c.color || "#22c55e" };
      this.modal = "category";
    },

    async saveCategory() {
      if (!this.catForm.name.trim()) { this.formError = this.t("error_fill_fields"); return; }
      this.saving = true;
      try {
        const data = { name: this.catForm.name.trim(), type: this.catForm.type, color: this.catForm.color };
        if (this.editingId) {
          await DB.updateCategory(this.user.uid, this.editingId, data);
          this.categories = this.categories.map(c => c.id === this.editingId ? { ...c, ...data } : c);
        } else {
          const id = await DB.addCategory(this.user.uid, data);
          this.categories = [...this.categories, { id, ...data }];
        }
        this.closeModal();
        this.toast(this.t("toast_saved"));
      } catch (e) {
        this.formError = this.t("error_generic");
      } finally {
        this.saving = false;
      }
    },

    async deleteCategory(id) {
      if (!confirm(this.t("confirm_delete"))) return;
      try {
        await DB.deleteCategory(this.user.uid, id);
        this.categories = this.categories.filter(c => c.id !== id);
        this.toast(this.t("toast_deleted"));
      } catch (e) {
        this.toast(this.t("error_generic"), "error");
      }
    },

    // ════════════════════════════════════════════════════════
    // PROJECTS
    // ════════════════════════════════════════════════════════
    openAddProject() {
      this.editingId = null;
      this.formError = "";
      this.projectForm = { name: "", totalBudget: "", date: "", description: "", isAllocation: false };
      this.modal = "project";
    },

    openEditProject(p) {
      this.editingId = p.id;
      this.formError = "";
      this.projectForm = {
        name: p.name || "",
        totalBudget: String(p.totalBudget || ""),
        date: p.date || "",
        description: p.description || "",
        isAllocation: p.isAllocation || false,
      };
      this.modal = "project";
    },

    async saveProject() {
      if (!this.projectForm.name.trim()) { this.formError = this.t("error_fill_fields"); return; }
      this.saving = true;
      try {
        const data = {
          name: this.projectForm.name.trim(),
          totalBudget: parseFloat(this.projectForm.totalBudget) || 0,
          date: this.projectForm.date || "",
          description: this.projectForm.description.trim(),
          isAllocation: this.projectForm.isAllocation,
        };
        if (this.editingId) {
          await DB.updateProject(this.user.uid, this.editingId, data);
          this.projects = this.projects.map(p => p.id === this.editingId ? { ...p, ...data } : p);
        } else {
          const id = await DB.addProject(this.user.uid, data);
          this.projects = [...this.projects, { id, ...data, items: [] }];
          this.activeProjectId = id;
        }
        this.closeModal();
        this.toast(this.t("toast_saved"));
      } catch (e) {
        this.formError = this.t("error_generic");
      } finally {
        this.saving = false;
      }
    },

    async deleteProject(id) {
      if (!confirm(this.t("confirm_delete"))) return;
      try {
        await DB.deleteProject(this.user.uid, id);
        this.projects = this.projects.filter(p => p.id !== id);
        if (this.activeProjectId === id) this.activeProjectId = this.projects[0]?.id || null;
        this.toast(this.t("toast_deleted"));
      } catch (e) {
        this.toast(this.t("error_generic"), "error");
      }
    },

    selectProject(id) {
      this.activeProjectId = id;
    },

    // ── Project Items ─────────────────────────────────────────
    openAddProjectItem() {
      this.editingId = null;
      this.formError = "";
      this.projectItemForm = { category: "", budgeted: "", spent: "0", notes: "" };
      this.modal = "projectItem";
    },

    openEditProjectItem(item) {
      this.editingId = item.id;
      this.formError = "";
      this.projectItemForm = {
        category: item.category || "",
        budgeted: String(item.budgeted || ""),
        spent: String(item.spent || "0"),
        notes: item.notes || "",
      };
      this.modal = "projectItem";
    },

    async saveProjectItem() {
      if (!this.projectItemForm.category.trim()) { this.formError = this.t("error_fill_fields"); return; }
      const pid = this.activeProjectId;
      const project = this.projects.find(p => p.id === pid);
      if (!project) { this.saving = false; return; }
      this.saving = true;
      try {
        const itemData = {
          category: this.projectItemForm.category.trim(),
          budgeted: parseFloat(this.projectItemForm.budgeted) || 0,
          spent: parseFloat(this.projectItemForm.spent) || 0,
          notes: this.projectItemForm.notes.trim(),
        };
        let newItems;
        if (this.editingId) {
          newItems = (project.items || []).map(i => i.id === this.editingId ? { ...i, ...itemData } : i);
        } else {
          newItems = [...(project.items || []), { id: generateId(), ...itemData }];
        }
        await DB.updateProjectItems(this.user.uid, pid, newItems);
        this.projects = this.projects.map(p => p.id === pid ? { ...p, items: newItems } : p);
        this.closeModal();
        this.toast(this.t("toast_saved"));
      } catch (e) {
        this.formError = this.t("error_generic");
      } finally {
        this.saving = false;
      }
    },

    async deleteProjectItem(itemId) {
      if (!confirm(this.t("confirm_delete"))) return;
      const pid = this.activeProjectId;
      const project = this.projects.find(p => p.id === pid);
      if (!project) return;
      try {
        const newItems = (project.items || []).filter(i => i.id !== itemId);
        await DB.updateProjectItems(this.user.uid, pid, newItems);
        this.projects = this.projects.map(p => p.id === pid ? { ...p, items: newItems } : p);
        this.toast(this.t("toast_deleted"));
      } catch (e) {
        this.toast(this.t("error_generic"), "error");
      }
    },
  });
}
