import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";

import { api, Budget, Category } from "@/src/api";
import { theme } from "@/src/theme";
import { formatINR } from "@/src/utils/currency";
import { showToast } from "@/src/components/Toast";
import ScreenHeader from "@/src/components/ScreenHeader";

export default function Budgets() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, c] = await Promise.all([api.listBudgets(), api.listCategories()]);
      setBudgets(b);
      setCategories(c);
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const onDelete = async (id: string) => {
    try {
      await api.deleteBudget(id);
      showToast("Budget removed", "success");
      void load();
    } catch (e) {
      showToast((e as Error).message, "error");
    }
  };

  const withoutBudgets = categories.filter((c) => !budgets.find((b) => b.category_id === c.id));

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="budgets-screen">
      <ScreenHeader
        title="Budget goals"
        right={
          <TouchableOpacity
            testID="add-budget-button"
            onPress={() => setCreating(true)}
            style={styles.iconBtn}
            disabled={withoutBudgets.length === 0}
          >
            <Ionicons
              name="add"
              size={22}
              color={withoutBudgets.length === 0 ? theme.colors.textDim : theme.colors.text}
            />
          </TouchableOpacity>
        }
      />

      {loading ? (
        <ActivityIndicator color={theme.colors.brand} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 80 }}>
          <Text style={styles.helper}>
            Set a monthly spend limit per category. You&apos;ll see over-spend alerts on the dashboard.
          </Text>

          {budgets.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="flag-outline" size={40} color={theme.colors.textDim} />
              <Text style={styles.emptyText}>No budgets yet.</Text>
              <TouchableOpacity
                testID="add-first-budget"
                onPress={() => setCreating(true)}
                style={styles.emptyBtn}
              >
                <Text style={styles.emptyBtnText}>Add first budget</Text>
              </TouchableOpacity>
            </View>
          ) : (
            budgets.map((b) => {
              const pct = Math.min(100, b.percent);
              const over = b.percent >= 100;
              const near = b.percent >= 80 && !over;
              const barColor = over ? theme.colors.error : near ? theme.colors.warn : b.category_color;
              return (
                <View key={b.id} style={styles.card} testID={`budget-row-${b.category_id}`}>
                  <View style={styles.rowTop}>
                    <View style={[styles.dot, { backgroundColor: b.category_color }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.name}>{b.category_name}</Text>
                      <Text style={styles.meta}>
                        {formatINR(b.spent)} spent of {formatINR(b.amount)} this month
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => setEditing(b)} style={styles.iconBtn} testID={`edit-budget-${b.category_id}`}>
                      <Ionicons name="create-outline" size={18} color={theme.colors.textMuted} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => onDelete(b.id)} style={styles.iconBtn} testID={`delete-budget-${b.category_id}`}>
                      <Ionicons name="trash-outline" size={18} color={theme.colors.error} />
                    </TouchableOpacity>
                  </View>
                  <View style={styles.barTrack}>
                    <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: barColor }]} />
                  </View>
                  <Text style={[styles.pct, { color: barColor }]}>
                    {Math.round(b.percent)}%
                    {over ? ` · over by ${formatINR(b.spent - b.amount)}` : near ? " · getting close" : ""}
                  </Text>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      <BudgetModal
        visible={creating || !!editing}
        budget={editing}
        categories={withoutBudgets.length > 0 || !!editing ? (editing ? categories.filter((c) => c.id === editing.category_id) : withoutBudgets) : []}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          void load();
        }}
      />
    </SafeAreaView>
  );
}

function BudgetModal({
  visible,
  budget,
  categories,
  onClose,
  onSaved,
}: {
  visible: boolean;
  budget: Budget | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (visible) {
      setCategoryId(budget?.category_id ?? categories[0]?.id ?? null);
      setAmount(budget ? String(budget.amount) : "");
    }
  }, [visible, budget, categories]);

  const save = async () => {
    if (!categoryId) {
      showToast("Pick a category", "error");
      return;
    }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      showToast("Enter a valid amount", "error");
      return;
    }
    setSaving(true);
    try {
      await api.saveBudget({ category_id: categoryId, amount: amt });
      showToast(budget ? "Budget updated" : "Budget added", "success");
      onSaved();
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.sheetWrap}
        pointerEvents="box-none"
      >
        <View style={styles.sheet} testID="budget-modal">
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{budget ? "Edit budget" : "New budget"}</Text>

          <Text style={styles.label}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {categories.map((c) => (
              <TouchableOpacity
                key={c.id}
                testID={`budget-cat-${c.id}`}
                onPress={() => setCategoryId(c.id)}
                disabled={!!budget}
                style={[styles.chip, categoryId === c.id && styles.chipActive, !!budget && { opacity: 0.6 }]}
              >
                <View style={[styles.dotSm, { backgroundColor: c.color }]} />
                <Text style={[styles.chipText, categoryId === c.id && styles.chipTextActive]}>{c.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.label}>Monthly limit (₹)</Text>
          <TextInput
            testID="budget-amount-input"
            style={styles.input}
            value={amount}
            onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ""))}
            placeholder="e.g. 8000"
            placeholderTextColor={theme.colors.textDim}
            keyboardType="decimal-pad"
            autoFocus
          />

          <TouchableOpacity
            testID="save-budget-button"
            onPress={save}
            disabled={saving}
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            activeOpacity={0.85}
          >
            {saving ? <ActivityIndicator color={theme.colors.onBrand} /> : <Text style={styles.saveBtnText}>Save</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  helper: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 20, marginBottom: 16 },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20 },
  empty: {
    alignItems: "center",
    padding: 40,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: "dashed",
  },
  emptyText: { color: theme.colors.textMuted, fontSize: 14, marginTop: 12 },
  emptyBtn: {
    marginTop: 16,
    backgroundColor: theme.colors.brand,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: theme.radius.pill,
  },
  emptyBtnText: { color: theme.colors.onBrand, fontWeight: "700", fontSize: 13 },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  rowTop: { flexDirection: "row", alignItems: "center", marginBottom: 10, gap: 10 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  name: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
  meta: { color: theme.colors.textDim, fontSize: 12, marginTop: 2 },
  barTrack: { height: 6, backgroundColor: theme.colors.surface2, borderRadius: 3, overflow: "hidden" },
  barFill: { height: 6, borderRadius: 3 },
  pct: { fontSize: 12, fontWeight: "700", marginTop: 6 },
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
  sheetTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "700", marginBottom: 8 },
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
  dotSm: { width: 8, height: 8, borderRadius: 4 },
  saveBtn: {
    marginTop: 20,
    height: 52,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: { color: theme.colors.onBrand, fontWeight: "700", fontSize: 15 },
});
