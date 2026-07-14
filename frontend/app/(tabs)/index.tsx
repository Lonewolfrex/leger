import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";

import { api, DashboardData } from "@/src/api";
import { theme } from "@/src/theme";
import { formatINR } from "@/src/utils/currency";
import { showToast } from "@/src/components/Toast";
import { useAuth } from "@/src/context/AuthContext";

const PERIODS: { key: string; label: string }[] = [
  { key: "daily", label: "Daily" },
  { key: "weekly", label: "Weekly" },
  { key: "monthly", label: "Monthly" },
  { key: "quarterly", label: "Quarterly" },
  { key: "biannual", label: "Half-yearly" },
  { key: "yearly", label: "Yearly" },
];

export default function Dashboard() {
  const { user } = useAuth();
  const [period, setPeriod] = useState("monthly");
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async (p: string, isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const d = await api.dashboard(p);
      setData(d);
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load(period);
    }, [load, period])
  );

  useEffect(() => {
    void load(period);
  }, [period, load]);

  const onRefresh = () => {
    setRefreshing(true);
    void load(period, true);
  };

  const total = data?.total ?? 0;
  const count = data?.expense_count ?? 0;

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="dashboard-screen">
      <View style={styles.header}>
        <View>
          <Text style={styles.hi}>Hi, {user?.name?.split(" ")[0] || "there"}</Text>
          <Text style={styles.title}>Household ledger</Text>
        </View>
      </View>

      <View style={styles.chipRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRowContent}
        >
          {PERIODS.map((p) => {
            const active = period === p.key;
            return (
              <TouchableOpacity
                key={p.key}
                testID={`period-chip-${p.key}`}
                onPress={() => setPeriod(p.key)}
                style={[styles.chip, active && styles.chipActive]}
                activeOpacity={0.8}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{p.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.colors.brand}
          />
        }
      >
        <View style={styles.heroCard} testID="dashboard-hero">
          <Text style={styles.heroLabel}>Total spent</Text>
          <Text style={styles.heroAmount} testID="dashboard-total">
            {formatINR(total)}
          </Text>
          <View style={styles.heroMetaRow}>
            <View style={styles.heroMeta}>
              <Text style={styles.heroMetaK}>{count}</Text>
              <Text style={styles.heroMetaLabel}>expenses</Text>
            </View>
            <View style={styles.heroMetaDivider} />
            <View style={styles.heroMeta}>
              <Text style={styles.heroMetaK}>{data?.by_category.length ?? 0}</Text>
              <Text style={styles.heroMetaLabel}>categories</Text>
            </View>
            <View style={styles.heroMetaDivider} />
            <View style={styles.heroMeta}>
              <Text style={styles.heroMetaK}>{data?.by_earner.length ?? 0}</Text>
              <Text style={styles.heroMetaLabel}>earners</Text>
            </View>
          </View>
          {data && (
            <Text style={styles.heroRange}>
              {formatDate(data.start)} — {formatDate(data.end)}
            </Text>
          )}
        </View>

        <SectionHeader title="By category" />
        {loading && !data ? (
          <ActivityIndicator color={theme.colors.brand} style={{ marginTop: 24 }} />
        ) : (data?.by_category.length ?? 0) === 0 ? (
          <EmptyState text="No expenses in this period yet." />
        ) : (
          data!.by_category.map((c) => {
            const isOpen = !!expanded[c.category_id];
            const pct = total > 0 ? (c.total / total) * 100 : 0;
            return (
              <View key={c.category_id} style={styles.catCard} testID={`dashboard-cat-${c.category_id}`}>
                <TouchableOpacity
                  onPress={() =>
                    setExpanded((e) => ({ ...e, [c.category_id]: !e[c.category_id] }))
                  }
                  activeOpacity={0.7}
                  style={styles.catRow}
                >
                  <View style={[styles.catIcon, { backgroundColor: c.color + "22" }]}>
                    <Ionicons name={(c.icon || "pricetag") as never} size={18} color={c.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.catName}>{c.name}</Text>
                    <Text style={styles.catMeta}>
                      {c.count} {c.count === 1 ? "expense" : "expenses"} · {pct.toFixed(0)}%
                    </Text>
                  </View>
                  <Text style={styles.catAmount}>{formatINR(c.total)}</Text>
                  {c.subcategories.length > 0 && (
                    <Ionicons
                      name={isOpen ? "chevron-up" : "chevron-down"}
                      color={theme.colors.textDim}
                      size={16}
                      style={{ marginLeft: 8 }}
                    />
                  )}
                </TouchableOpacity>
                <View style={styles.barTrack}>
                  <View style={[styles.barFill, { width: `${Math.min(100, pct)}%`, backgroundColor: c.color }]} />
                </View>
                {isOpen &&
                  c.subcategories.map((s) => (
                    <View key={s.id} style={styles.subRow}>
                      <Text style={styles.subName}>{s.name}</Text>
                      <Text style={styles.subAmt}>{formatINR(s.total)}</Text>
                    </View>
                  ))}
              </View>
            );
          })
        )}

        {data && data.by_earner.length > 0 && (
          <>
            <SectionHeader title="By earner" />
            {data.by_earner.map((e) => (
              <View key={e.user_id} style={styles.earnerRow} testID={`dashboard-earner-${e.user_id}`}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initials(e.name)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.earnerName}>{e.name}</Text>
                  <Text style={styles.earnerMeta}>
                    {e.count} {e.count === 1 ? "expense" : "expenses"}
                  </Text>
                </View>
                <Text style={styles.earnerAmt}>{formatINR(e.total)}</Text>
              </View>
            ))}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <View style={styles.empty} testID="dashboard-empty">
      <Ionicons name="pie-chart-outline" size={48} color={theme.colors.textDim} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  hi: { color: theme.colors.textMuted, fontSize: 13 },
  title: {
    color: theme.colors.text,
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.5,
    marginTop: 2,
  },
  chipRow: { height: 56 },
  chipRowContent: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: "center",
    height: 56,
  },
  chip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  chipActive: {
    borderColor: theme.colors.brand,
    backgroundColor: theme.colors.brandDim,
  },
  chipText: {
    color: theme.colors.textMuted,
    fontSize: 13,
    fontWeight: "600",
  },
  chipTextActive: {
    color: theme.colors.brand,
  },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 8 },
  heroCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    padding: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  heroLabel: {
    color: theme.colors.textMuted,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  heroAmount: {
    color: theme.colors.text,
    fontSize: 40,
    fontWeight: "800",
    letterSpacing: -1,
    marginTop: 6,
  },
  heroMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 16,
  },
  heroMeta: { flex: 1 },
  heroMetaDivider: {
    width: 1,
    height: 28,
    backgroundColor: theme.colors.border,
    marginHorizontal: 12,
  },
  heroMetaK: {
    color: theme.colors.brand,
    fontSize: 18,
    fontWeight: "700",
  },
  heroMetaLabel: {
    color: theme.colors.textDim,
    fontSize: 11,
    marginTop: 2,
  },
  heroRange: {
    color: theme.colors.textDim,
    fontSize: 11,
    marginTop: 14,
  },
  sectionHeader: {
    marginTop: 24,
    marginBottom: 10,
  },
  sectionTitle: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: "700",
  },
  catCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  catRow: { flexDirection: "row", alignItems: "center" },
  catIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  catName: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "600",
  },
  catMeta: {
    color: theme.colors.textDim,
    fontSize: 12,
    marginTop: 2,
  },
  catAmount: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  barTrack: {
    height: 4,
    backgroundColor: theme.colors.surface2,
    borderRadius: 2,
    marginTop: 12,
    overflow: "hidden",
  },
  barFill: { height: 4, borderRadius: 2 },
  subRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 10,
    paddingLeft: 48,
  },
  subName: { color: theme.colors.textMuted, fontSize: 13 },
  subAmt: { color: theme.colors.text, fontSize: 13, fontWeight: "600" },
  earnerRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.brandDim,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  avatarText: {
    color: theme.colors.brand,
    fontWeight: "700",
    fontSize: 13,
  },
  earnerName: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
  earnerMeta: { color: theme.colors.textDim, fontSize: 12, marginTop: 2 },
  earnerAmt: { color: theme.colors.text, fontSize: 15, fontWeight: "700" },
  empty: {
    alignItems: "center",
    paddingVertical: 40,
    gap: 12,
  },
  emptyText: { color: theme.colors.textMuted, fontSize: 14 },
});
