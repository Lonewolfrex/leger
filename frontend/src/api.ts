import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;
const TOKEN_KEY = "auth_session_token_v1";

export async function getToken(): Promise<string | null> {
  return await storage.secureGet<string>(TOKEN_KEY, "");
}
export async function setToken(token: string): Promise<void> {
  await storage.secureSet(TOKEN_KEY, token);
}
export async function clearToken(): Promise<void> {
  await storage.secureRemove(TOKEN_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; query?: Record<string, string | number | undefined | null> } = {}
): Promise<T> {
  const token = await getToken();
  const qs = options.query
    ? "?" +
      Object.entries(options.query)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join("&")
    : "";
  const res = await fetch(`${BASE}/api${path}${qs}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const detail =
      (data as { detail?: string } | null)?.detail ||
      (typeof data === "string" ? data : `HTTP ${res.status}`);
    throw new ApiError(detail, res.status);
  }
  return data as T;
}

// ---------------- Types ----------------
export type User = {
  user_id: string;
  email: string;
  name: string;
  picture?: string | null;
  household_id: string;
};

export type Subcategory = { id: string; name: string };
export type Category = {
  id: string;
  household_id: string;
  name: string;
  icon: string;
  color: string;
  subcategories: Subcategory[];
};

export type Expense = {
  id: string;
  household_id: string;
  amount: number;
  category_id: string;
  category_name: string;
  subcategory_id?: string | null;
  subcategory_name?: string | null;
  note: string;
  date: string;
  receipt_base64?: string | null;
  paid_by_user_id: string;
  paid_by_name: string;
  created_at: string;
};

export type HouseholdMember = {
  user_id: string;
  name: string;
  email: string;
  picture?: string | null;
};

export type Household = {
  id: string;
  name: string;
  invite_code: string;
  members: HouseholdMember[];
};

export type DashboardData = {
  period: string;
  start: string;
  end: string;
  total: number;
  expense_count: number;
  by_category: {
    category_id: string;
    name: string;
    color: string;
    icon: string;
    total: number;
    count: number;
    subcategories: { id: string; name: string; total: number; count: number }[];
  }[];
  by_earner: { user_id: string; name: string; total: number; count: number }[];
  budgets: {
    id: string;
    category_id: string;
    category_name: string;
    category_color: string;
    amount: number;
    spent: number;
    percent: number;
    remaining: number;
  }[];
};

export type Budget = {
  id: string;
  household_id: string;
  category_id: string;
  category_name: string;
  category_color: string;
  amount: number;
  period: string;
  spent: number;
  percent: number;
  remaining: number;
};

export type Recurring = {
  id: string;
  household_id: string;
  amount: number;
  category_id: string;
  category_name: string;
  subcategory_id?: string | null;
  subcategory_name?: string | null;
  note: string;
  frequency: "monthly" | "weekly";
  day_of_month?: number | null;
  day_of_week?: number | null;
  next_run_date: string;
  is_active: boolean;
  created_by_user_id: string;
};

export type Reminder = {
  id: string;
  household_id: string;
  title: string;
  amount?: number | null;
  due_date: string;
  repeat: "none" | "monthly";
  created_by_user_id: string;
};

export type SubscriptionStatus = {
  plan_started_at: string;
  days_since_start: number;
  phase: "free" | "premium_trial" | "paid" | "expired";
  days_until_next_phase: number;
  premium_active: boolean;
  founding_offer_available: boolean;
  is_founding_member: boolean;
  price_monthly: number;
  price_annual: number;
  founding_annual_price: number;
  subscription_expires_at?: string | null;
};

// ---------------- Endpoints ----------------
export const api = {
  createSession: (session_id: string) =>
    request<{ user: User; session_token: string }>("/auth/session", {
      method: "POST",
      body: { session_id },
    }),
  me: () => request<User>("/auth/me"),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),

  subscriptionStatus: () => request<SubscriptionStatus>("/subscription/status"),
  activateSubscription: (plan: "monthly" | "annual" | "founding_annual") =>
    request<SubscriptionStatus>("/subscription/activate", { method: "POST", body: { plan } }),

  getHousehold: () => request<Household>("/household"),
  joinHousehold: (code: string) =>
    request<Household>("/household/join", { method: "POST", body: { code } }),

  listCategories: () => request<Category[]>("/categories"),
  createCategory: (b: { name: string; icon?: string; color?: string }) =>
    request<Category>("/categories", { method: "POST", body: b }),
  updateCategory: (id: string, b: { name: string; icon?: string; color?: string }) =>
    request<Category>(`/categories/${id}`, { method: "PUT", body: b }),
  deleteCategory: (id: string) => request<{ ok: boolean }>(`/categories/${id}`, { method: "DELETE" }),
  addSubcategory: (categoryId: string, name: string) =>
    request<Category>(`/categories/${categoryId}/subcategories`, { method: "POST", body: { name } }),
  updateSubcategory: (categoryId: string, subId: string, name: string) =>
    request<Category>(`/categories/${categoryId}/subcategories/${subId}`, { method: "PUT", body: { name } }),
  deleteSubcategory: (categoryId: string, subId: string) =>
    request<Category>(`/categories/${categoryId}/subcategories/${subId}`, { method: "DELETE" }),

  listExpenses: (q: {
    start?: string;
    end?: string;
    category_id?: string;
    paid_by?: string;
    min_amount?: number;
    max_amount?: number;
    q?: string;
  } = {}) => request<Expense[]>("/expenses", { query: q }),
  createExpense: (b: {
    amount: number;
    category_id: string;
    subcategory_id?: string | null;
    note?: string;
    date: string;
    receipt_base64?: string | null;
  }) => request<Expense>("/expenses", { method: "POST", body: b }),
  updateExpense: (
    id: string,
    b: {
      amount: number;
      category_id: string;
      subcategory_id?: string | null;
      note?: string;
      date: string;
      receipt_base64?: string | null;
    }
  ) => request<Expense>(`/expenses/${id}`, { method: "PUT", body: b }),
  getExpense: (id: string) => request<Expense>(`/expenses/${id}`),
  deleteExpense: (id: string) => request<{ ok: boolean }>(`/expenses/${id}`, { method: "DELETE" }),

  dashboard: (period: string) => request<DashboardData>("/dashboard", { query: { period } }),

  listBudgets: () => request<Budget[]>("/budgets"),
  saveBudget: (b: { category_id: string; amount: number }) =>
    request<Budget>("/budgets", { method: "POST", body: { ...b, period: "monthly" } }),
  deleteBudget: (id: string) => request<{ ok: boolean }>(`/budgets/${id}`, { method: "DELETE" }),

  listRecurring: () => request<Recurring[]>("/recurring"),
  createRecurring: (b: {
    amount: number;
    category_id: string;
    subcategory_id?: string | null;
    note?: string;
    frequency: "monthly" | "weekly";
    day_of_month?: number | null;
    day_of_week?: number | null;
    next_run_date: string;
    is_active: boolean;
  }) => request<Recurring>("/recurring", { method: "POST", body: b }),
  updateRecurring: (
    id: string,
    b: {
      amount: number;
      category_id: string;
      subcategory_id?: string | null;
      note?: string;
      frequency: "monthly" | "weekly";
      day_of_month?: number | null;
      day_of_week?: number | null;
      next_run_date: string;
      is_active: boolean;
    }
  ) => request<Recurring>(`/recurring/${id}`, { method: "PUT", body: b }),
  deleteRecurring: (id: string) => request<{ ok: boolean }>(`/recurring/${id}`, { method: "DELETE" }),

  listReminders: () => request<Reminder[]>("/reminders"),
  createReminder: (b: { title: string; amount?: number | null; due_date: string; repeat: "none" | "monthly" }) =>
    request<Reminder>("/reminders", { method: "POST", body: b }),
  updateReminder: (
    id: string,
    b: { title: string; amount?: number | null; due_date: string; repeat: "none" | "monthly" }
  ) => request<Reminder>(`/reminders/${id}`, { method: "PUT", body: b }),
  deleteReminder: (id: string) => request<{ ok: boolean }>(`/reminders/${id}`, { method: "DELETE" }),

  exportCSV: (q: { start?: string; end?: string } = {}) =>
    request<{ filename: string; content: string; count: number }>("/export/csv", { query: q }),
};
