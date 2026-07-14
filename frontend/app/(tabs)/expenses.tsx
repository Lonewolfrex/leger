import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api, Category, Expense, HouseholdMember } from "@/src/api";
import { theme } from "@/src/theme";
import { formatINR } from "@/src/utils/currency";
import { showToast } from "@/src/components/Toast";
import { useSubscription } from "@/src/context/SubscriptionContext";
import PremiumBanner from "@/src/components/PremiumBanner";
import LockedFeatureSheet from "@/src/components/LockedFeatureSheet";

type Filters = {
  q: string;
  categoryId: string | null;
  paidBy: string | null;
  min: string;
  max: string;
};

const emptyFilters: Filters = { q: "", categoryId: null, paidBy: null, min: "", max: "" };

export default function Expenses() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isPremiumActive } = useSubscription();
  const [items, setItems] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [lockedOpen, setLockedOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [members, setMembers] = useState<HouseholdMember[]>([]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.q) n++;
    if (filters.categoryId) n++;
    if (filters.paidBy) n++;
    if (filters.min) n++;
    if (filters.max) n++;
    return n;
  }, [filters]);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const data = await api.listExpenses({
        q: filters.q || undefined,
        category_id: filters.categoryId || undefined,
        paid_by: filters.paidBy || undefined,
        min_amount: filters.min ? Number(filters.min) : undefined,
        max_amount: filters.max ? Number(filters.max) : undefined,
      });
      setItems(data);
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filters]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const loadFilterOptions = useCallback(async () => {
    try {
      const [cats, hh] = await Promise.all([api.listCategories(), api.getHousehold()]);
      setCategories(cats);
      setMembers(hh.members);
    } catch {
      // ignore
    }
  }, []);

  const openSearch = () => {
    if (!isPremiumActive) {
      setLockedOpen(true);
      return;
    }
    void loadFilterOptions();
    setFiltersOpen(true);
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="expenses-screen">
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Expenses</Text>
          <Text style={styles.subtitle}>
            {items.length} {items.length === 1 ? "entry" : "entries"}
            {activeFilterCount > 0 ? ` · ${activeFilterCount} filter${activeFilterCount > 1 ? "s" : ""}` : ""}
          </Text>
        </View>
        <TouchableOpacity
          testID="open-search-button"
          style={[styles.searchBtn, activeFilterCount > 0 && { backgroundColor: theme.colors.brandDim, borderColor: theme.colors.brand }]}
          onPress={openSearch}
          activeOpacity={0.85}
        >
          <Ionicons name="search" size={16} color={activeFilterCount > 0 ? theme.colors.brand : theme.colors.textMuted} />
          {!isPremiumActive && <Ionicons name="lock-closed" size={10} color={theme.colors.warn} style={{ marginLeft: 4 }} />}
        </TouchableOpacity>
      </View>

      <PremiumBanner />

      {loading && items.length === 0 ? (
        <ActivityIndicator color={theme.colors.brand} style={{ marginTop: 40 }} />
      ) : items.length === 0 ? (
        <View style={styles.empty} testID="expenses-empty">
          <Ionicons name="receipt-outline" size={56} color={theme.colors.textDim} />
          <Text style={styles.emptyTitle}>{activeFilterCount > 0 ? "No matches" : "No expenses yet"}</Text>
          <Text style={styles.emptyText}>
            {activeFilterCount > 0
              ? "Try changing your filters or clear them."
              : "Tap the + button to add your first entry."}
          </Text>
          {activeFilterCount > 0 && (
            <TouchableOpacity
              testID="clear-filters-inline"
              onPress={() => setFilters(emptyFilters)}
              style={styles.clearInline}
            >
              <Text style={styles.clearInlineText}>Clear filters</Text>
            </TouchableOpacity>
          )}
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 140 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }} tintColor={theme.colors.brand} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              testID={`expense-item-${item.id}`}
              style={styles.card}
              activeOpacity={0.75}
              onPress={() => router.push({ pathname: "/expense/edit", params: { id: item.id } })}
            >
              <View style={styles.thumbWrap}>
                {item.receipt_base64 ? (
                  <Image source={{ uri: normalizeBase64(item.receipt_base64) }} style={styles.thumb} />
                ) : (
                  <View style={[styles.thumb, styles.thumbPlaceholder]}>
                    <Ionicons name="pricetag" size={16} color={theme.colors.brand} />
                  </View>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.category_name}
                  {item.subcategory_name ? ` · ${item.subcategory_name}` : ""}
                </Text>
                <Text style={styles.cardMeta} numberOfLines={1}>
                  {formatDate(item.date)} · {item.paid_by_name}
                </Text>
                {!!item.note && (
                  <Text style={styles.cardNote} numberOfLines={1}>
                    {item.note}
                  </Text>
                )}
              </View>
              <Text style={styles.cardAmount}>{formatINR(item.amount)}</Text>
            </TouchableOpacity>
          )}
        />
      )}

      <TouchableOpacity
        testID="add-expense-fab"
        onPress={() => router.push("/expense/add")}
        style={[styles.fab, { bottom: insets.bottom + 76 }]}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={28} color={theme.colors.onBrand} />
      </TouchableOpacity>

      <FiltersSheet
        visible={filtersOpen}
        filters={filters}
        categories={categories}
        members={members}
        onClose={() => setFiltersOpen(false)}
        onApply={(next) => {
          setFilters(next);
          setFiltersOpen(false);
        }}
        onClear={() => {
          setFilters(emptyFilters);
          setFiltersOpen(false);
        }}
      />
      <LockedFeatureSheet visible={lockedOpen} featureName="Search & filters" onClose={() => setLockedOpen(false)} />
    </SafeAreaView>
  );
}

function FiltersSheet({
  visible,
  filters,
  categories,
  members,
  onClose,
  onApply,
  onClear,
}: {
  visible: boolean;
  filters: Filters;
  categories: Category[];
  members: HouseholdMember[];
  onClose: () => void;
  onApply: (f: Filters) => void;
  onClear: () => void;
}) {
  const [local, setLocal] = useState<Filters>(filters);
  React.useEffect(() => {
    if (visible) setLocal(filters);
  }, [visible, filters]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheetWrap} pointerEvents="box-none">
        <View style={styles.sheet} testID="filters-sheet">
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Search &amp; filter</Text>

          <Text style={styles.label}>Note contains</Text>
          <TextInput
            testID="filter-q-input"
            style={styles.input}
            value={local.q}
            onChangeText={(v) => setLocal({ ...local, q: v })}
            placeholder="e.g. rent, milk, Amazon"
            placeholderTextColor={theme.colors.textDim}
          />

          <Text style={styles.label}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            <TouchableOpacity
              onPress={() => setLocal({ ...local, categoryId: null })}
              style={[styles.chip, !local.categoryId && styles.chipActive]}
            >
              <Text style={[styles.chipText, !local.categoryId && styles.chipTextActive]}>All</Text>
            </TouchableOpacity>
            {categories.map((c) => (
              <TouchableOpacity
                key={c.id}
                testID={`filter-cat-${c.id}`}
                onPress={() => setLocal({ ...local, categoryId: c.id })}
                style={[styles.chip, local.categoryId === c.id && styles.chipActive]}
              >
                <View style={[styles.dot, { backgroundColor: c.color }]} />
                <Text style={[styles.chipText, local.categoryId === c.id && styles.chipTextActive]}>{c.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {members.length > 1 && (
            <>
              <Text style={styles.label}>Paid by</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                <TouchableOpacity
                  onPress={() => setLocal({ ...local, paidBy: null })}
                  style={[styles.chip, !local.paidBy && styles.chipActive]}
                >
                  <Text style={[styles.chipText, !local.paidBy && styles.chipTextActive]}>Anyone</Text>
                </TouchableOpacity>
                {members.map((m) => (
                  <TouchableOpacity
                    key={m.user_id}
                    onPress={() => setLocal({ ...local, paidBy: m.user_id })}
                    style={[styles.chip, local.paidBy === m.user_id && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, local.paidBy === m.user_id && styles.chipTextActive]}>
                      {m.name.split(" ")[0]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          <Text style={styles.label}>Amount range (₹)</Text>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <TextInput
              testID="filter-min-input"
              style={[styles.input, { flex: 1 }]}
              value={local.min}
              onChangeText={(v) => setLocal({ ...local, min: v.replace(/[^0-9.]/g, "") })}
              placeholder="Min"
              placeholderTextColor={theme.colors.textDim}
              keyboardType="decimal-pad"
            />
            <TextInput
              testID="filter-max-input"
              style={[styles.input, { flex: 1 }]}
              value={local.max}
              onChangeText={(v) => setLocal({ ...local, max: v.replace(/[^0-9.]/g, "") })}
              placeholder="Max"
              placeholderTextColor={theme.colors.textDim}
              keyboardType="decimal-pad"
            />
          </View>

          <View style={{ flexDirection: "row", gap: 12, marginTop: 20 }}>
            <TouchableOpacity onPress={onClear} testID="clear-filters-button" style={styles.clearBtn} activeOpacity={0.85}>
              <Text style={styles.clearBtnText}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID="apply-filters-button"
              onPress={() => onApply(local)}
              style={styles.saveBtn}
              activeOpacity={0.85}
            >
              <Text style={styles.saveBtnText}>Apply</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function normalizeBase64(s: string): string {
  return s.startsWith("data:") ? s : `data:image/jpeg;base64,${s}`;
}
function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  } catch {
    return iso;
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 12, flexDirection: "row", alignItems: "center" },
  title: { color: theme.colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { color: theme.colors.textDim, fontSize: 13, marginTop: 2 },
  searchBtn: {
    flexDirection: "row",
    alignItems: "center",
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
    justifyContent: "center",
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  thumbWrap: { marginRight: 12 },
  thumb: { width: 44, height: 44, borderRadius: 10 },
  thumbPlaceholder: { backgroundColor: theme.colors.brandDim, alignItems: "center", justifyContent: "center" },
  cardTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
  cardMeta: { color: theme.colors.textDim, fontSize: 12, marginTop: 2 },
  cardNote: { color: theme.colors.textMuted, fontSize: 12, marginTop: 2, fontStyle: "italic" },
  cardAmount: { color: theme.colors.text, fontSize: 15, fontWeight: "700", marginLeft: 12 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 40 },
  emptyTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "700", marginTop: 16 },
  emptyText: { color: theme.colors.textDim, fontSize: 14, marginTop: 6, textAlign: "center" },
  clearInline: {
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  clearInlineText: { color: theme.colors.brand, fontSize: 13, fontWeight: "600" },
  fab: {
    position: "absolute",
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: theme.colors.brand,
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)" },
  sheetWrap: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    backgroundColor: theme.colors.border,
    borderRadius: 2,
    marginBottom: 12,
  },
  sheetTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "700", marginBottom: 4 },
  label: {
    color: theme.colors.textMuted,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 16,
    marginBottom: 8,
  },
  input: {
    backgroundColor: theme.colors.surface2,
    color: theme.colors.text,
    borderRadius: theme.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    flexShrink: 0,
  },
  chipActive: { borderColor: theme.colors.brand, backgroundColor: theme.colors.brandDim },
  chipText: { color: theme.colors.textMuted, fontSize: 13, fontWeight: "600" },
  chipTextActive: { color: theme.colors.brand },
  dot: { width: 8, height: 8, borderRadius: 4 },
  saveBtn: {
    flex: 1,
    height: 48,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: { color: theme.colors.onBrand, fontWeight: "700", fontSize: 14 },
  clearBtn: {
    flex: 1,
    height: 48,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  clearBtnText: { color: theme.colors.text, fontWeight: "600", fontSize: 14 },
});
