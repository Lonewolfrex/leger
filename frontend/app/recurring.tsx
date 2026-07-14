import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";

import { api, Category, Recurring } from "@/src/api";
import { theme } from "@/src/theme";
import { formatINR } from "@/src/utils/currency";
import { showToast } from "@/src/components/Toast";
import ScreenHeader from "@/src/components/ScreenHeader";

type Draft = {
  amount: string;
  category_id: string | null;
  note: string;
  frequency: "monthly" | "weekly";
  next_run_date: string;
  is_active: boolean;
};

const emptyDraft = (): Draft => ({
  amount: "",
  category_id: null,
  note: "",
  frequency: "monthly",
  next_run_date: new Date().toISOString().slice(0, 10),
  is_active: true,
});

export default function RecurringScreen() {
  const [items, setItems] = useState<Recurring[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Recurring | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([api.listRecurring(), api.listCategories()]);
      setItems(r);
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
      await api.deleteRecurring(id);
      showToast("Recurring removed", "success");
      void load();
    } catch (e) {
      showToast((e as Error).message, "error");
    }
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="recurring-screen">
      <ScreenHeader
        title="Recurring expenses"
        right={
          <TouchableOpacity testID="add-recurring-button" onPress={() => setCreating(true)} style={styles.iconBtn}>
            <Ionicons name="add" size={22} color={theme.colors.text} />
          </TouchableOpacity>
        }
      />

      {loading ? (
        <ActivityIndicator color={theme.colors.brand} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 80 }}>
          <Text style={styles.helper}>
            Rent, EMIs, subscriptions — set them up once and they&apos;ll get logged automatically on the due date.
          </Text>

          {items.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="repeat" size={40} color={theme.colors.textDim} />
              <Text style={styles.emptyText}>No recurring expenses yet.</Text>
              <TouchableOpacity onPress={() => setCreating(true)} style={styles.emptyBtn} testID="add-first-recurring">
                <Text style={styles.emptyBtnText}>Add first recurring</Text>
              </TouchableOpacity>
            </View>
          ) : (
            items.map((r) => (
              <TouchableOpacity
                key={r.id}
                onPress={() => setEditing(r)}
                activeOpacity={0.75}
                style={styles.card}
                testID={`recurring-item-${r.id}`}
              >
                <View style={styles.rowTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>
                      {r.category_name}
                      {r.subcategory_name ? ` · ${r.subcategory_name}` : ""}
                    </Text>
                    <Text style={styles.meta}>
                      {r.frequency === "monthly" ? "Monthly" : "Weekly"} · next {r.next_run_date}
                      {!r.is_active && " · paused"}
                    </Text>
                    {!!r.note && <Text style={styles.note}>{r.note}</Text>}
                  </View>
                  <Text style={styles.amount}>{formatINR(r.amount)}</Text>
                  <TouchableOpacity onPress={() => onDelete(r.id)} style={styles.iconBtn} testID={`delete-recurring-${r.id}`}>
                    <Ionicons name="trash-outline" size={18} color={theme.colors.error} />
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}

      <RecurringModal
        visible={creating || !!editing}
        recurring={editing}
        categories={categories}
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

function RecurringModal({
  visible,
  recurring,
  categories,
  onClose,
  onSaved,
}: {
  visible: boolean;
  recurring: Recurring | null;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (visible) {
      if (recurring) {
        setDraft({
          amount: String(recurring.amount),
          category_id: recurring.category_id,
          note: recurring.note,
          frequency: recurring.frequency,
          next_run_date: recurring.next_run_date,
          is_active: recurring.is_active,
        });
      } else {
        setDraft({ ...emptyDraft(), category_id: categories[0]?.id ?? null });
      }
    }
  }, [visible, recurring, categories]);

  const save = async () => {
    if (!draft.category_id) {
      showToast("Pick a category", "error");
      return;
    }
    const amt = parseFloat(draft.amount);
    if (!amt || amt <= 0) {
      showToast("Enter a valid amount", "error");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.next_run_date)) {
      showToast("Date must be YYYY-MM-DD", "error");
      return;
    }
    setSaving(true);
    try {
      const day = parseInt(draft.next_run_date.slice(8, 10), 10);
      const body = {
        amount: amt,
        category_id: draft.category_id,
        subcategory_id: null,
        note: draft.note,
        frequency: draft.frequency,
        day_of_month: draft.frequency === "monthly" ? day : null,
        day_of_week: null,
        next_run_date: draft.next_run_date,
        is_active: draft.is_active,
      };
      if (recurring) {
        await api.updateRecurring(recurring.id, body);
        showToast("Recurring updated", "success");
      } else {
        await api.createRecurring(body);
        showToast("Recurring added", "success");
      }
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
        <ScrollView
          style={styles.sheetScroll}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }}
        >
          <View style={styles.sheet} testID="recurring-modal">
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{recurring ? "Edit recurring" : "New recurring"}</Text>

            <Text style={styles.label}>Amount (₹)</Text>
            <TextInput
              testID="recurring-amount"
              style={styles.input}
              value={draft.amount}
              onChangeText={(v) => setDraft({ ...draft, amount: v.replace(/[^0-9.]/g, "") })}
              placeholder="e.g. 15000"
              placeholderTextColor={theme.colors.textDim}
              keyboardType="decimal-pad"
            />

            <Text style={styles.label}>Category</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {categories.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  testID={`recurring-cat-${c.id}`}
                  onPress={() => setDraft({ ...draft, category_id: c.id })}
                  style={[styles.chip, draft.category_id === c.id && styles.chipActive]}
                >
                  <View style={[styles.dotSm, { backgroundColor: c.color }]} />
                  <Text style={[styles.chipText, draft.category_id === c.id && styles.chipTextActive]}>{c.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <Text style={styles.label}>Frequency</Text>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["monthly", "weekly"] as const).map((f) => (
                <TouchableOpacity
                  key={f}
                  testID={`recurring-freq-${f}`}
                  onPress={() => setDraft({ ...draft, frequency: f })}
                  style={[styles.freqBtn, draft.frequency === f && styles.freqBtnActive]}
                >
                  <Text style={[styles.freqText, draft.frequency === f && styles.freqTextActive]}>
                    {f[0].toUpperCase() + f.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>Next occurrence</Text>
            <TextInput
              testID="recurring-date"
              style={styles.input}
              value={draft.next_run_date}
              onChangeText={(v) => setDraft({ ...draft, next_run_date: v })}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={theme.colors.textDim}
            />

            <Text style={styles.label}>Note (optional)</Text>
            <TextInput
              testID="recurring-note"
              style={styles.input}
              value={draft.note}
              onChangeText={(v) => setDraft({ ...draft, note: v })}
              placeholder="Rent, Netflix, etc."
              placeholderTextColor={theme.colors.textDim}
            />

            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Active</Text>
              <Switch
                testID="recurring-active-switch"
                value={draft.is_active}
                onValueChange={(v) => setDraft({ ...draft, is_active: v })}
                trackColor={{ true: theme.colors.brand, false: theme.colors.surface2 }}
                thumbColor={theme.colors.text}
              />
            </View>

            <TouchableOpacity
              testID="save-recurring-button"
              onPress={save}
              disabled={saving}
              style={[styles.saveBtn, saving && { opacity: 0.6 }]}
              activeOpacity={0.85}
            >
              {saving ? <ActivityIndicator color={theme.colors.onBrand} /> : <Text style={styles.saveBtnText}>Save</Text>}
            </TouchableOpacity>
          </View>
        </ScrollView>
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
  rowTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
  meta: { color: theme.colors.textDim, fontSize: 12, marginTop: 2 },
  note: { color: theme.colors.textMuted, fontSize: 12, marginTop: 4, fontStyle: "italic" },
  amount: { color: theme.colors.text, fontSize: 15, fontWeight: "700", marginLeft: 10 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)" },
  sheetWrap: { flex: 1, justifyContent: "flex-end" },
  sheetScroll: { flexGrow: 0, maxHeight: "90%" },
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
    marginTop: 14,
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
  freqBtn: {
    flex: 1,
    height: 44,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  freqBtnActive: { borderColor: theme.colors.brand, backgroundColor: theme.colors.brandDim },
  freqText: { color: theme.colors.textMuted, fontSize: 14, fontWeight: "600" },
  freqTextActive: { color: theme.colors.brand },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 20,
    padding: 12,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  switchLabel: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
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
