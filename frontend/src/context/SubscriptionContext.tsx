import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AppState } from "react-native";
import { api, SubscriptionStatus } from "@/src/api";
import { useAuth } from "@/src/context/AuthContext";

type Ctx = {
  status: SubscriptionStatus | null;
  loading: boolean;
  refresh: () => Promise<void>;
  isPremiumActive: boolean;
};

const SubscriptionContext = createContext<Ctx | null>(null);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setStatus(null);
      setLoading(false);
      return;
    }
    try {
      const s = await api.subscriptionStatus();
      setStatus(s);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  return (
    <SubscriptionContext.Provider
      value={{ status, loading, refresh, isPremiumActive: !!status?.premium_active }}
    >
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription(): Ctx {
  const c = useContext(SubscriptionContext);
  if (!c) throw new Error("useSubscription must be used within SubscriptionProvider");
  return c;
}
