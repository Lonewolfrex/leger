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

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; query?: Record<string, string | undefined> } = {}
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
    const detail = (data as { detail?: string } | null)?.detail || (typeof data === "string" ? data : `HTTP ${res.status}`);
    throw new Error(detail);
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

  getHousehold: () => request<Household>("/household"),
  joinHousehold: (code: string) =>
    request<Household>("/household/join", { method: "POST", body: { code } }),

  listCategories: () => request<Category[]>("/categories"),
  createCategory: (b: { name: string; icon?: string; color?: string }) =>
    request<Category>("/categories", { method: "POST", body: b }),
  updateCategory: (id: string, b: { name: string; icon?: string; color?: string }) =>
    request<Category>(`/categories/${id}`, { method: "PUT", body: b }),
  deleteCategory: (id: string) =>
    request<{ ok: boolean }>(`/categories/${id}`, { method: "DELETE" }),
  addSubcategory: (categoryId: string, name: string) =>
    request<Category>(`/categories/${categoryId}/subcategories`, {
      method: "POST",
      body: { name },
    }),
  updateSubcategory: (categoryId: string, subId: string, name: string) =>
    request<Category>(`/categories/${categoryId}/subcategories/${subId}`, {
      method: "PUT",
      body: { name },
    }),
  deleteSubcategory: (categoryId: string, subId: string) =>
    request<Category>(`/categories/${categoryId}/subcategories/${subId}`, {
      method: "DELETE",
    }),

  listExpenses: (q: { start?: string; end?: string; category_id?: string } = {}) =>
    request<Expense[]>("/expenses", { query: q }),
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
  deleteExpense: (id: string) =>
    request<{ ok: boolean }>(`/expenses/${id}`, { method: "DELETE" }),

  dashboard: (period: string) =>
    request<DashboardData>("/dashboard", { query: { period } }),
};
