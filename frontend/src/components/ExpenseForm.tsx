import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
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
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";

import { api, Category, Expense } from "@/src/api";
import { theme } from "@/src/theme";
import { showToast } from "@/src/components/Toast";

type Props =
  | { mode: "create"; expenseId?: undefined }
  | { mode: "edit"; expenseId: string };

export default function ExpenseForm({ mode, expenseId }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);

  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null); // data URI
  const [pickerOpen, setPickerOpen] = useState<null | "category" | "subcategory">(null);

  useEffect(() => {
    (async () => {
      try {
        const cats = await api.listCategories();
        setCategories(cats);
        if (mode === "edit" && expenseId) {
          const ex = await api.getExpense(expenseId);
          hydrate(ex, cats);
        } else if (cats.length && !categoryId) {
          setCategoryId(cats[0].id);
        }
      } catch (e) {
        showToast((e as Error).message, "error");
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, expenseId]);

  const hydrate = (ex: Expense, cats: Category[]) => {
    setAmount(String(ex.amount));
    setNote(ex.note || "");
    setDate(ex.date);
    setCategoryId(ex.category_id);
    setSubcategoryId(ex.subcategory_id ?? null);
    if (ex.receipt_base64) {
      setReceipt(
        ex.receipt_base64.startsWith("data:")
          ? ex.receipt_base64
          : `data:image/jpeg;base64,${ex.receipt_base64}`
      );
    }
    if (!cats.find((c) => c.id === ex.category_id) && cats.length) {
      setCategoryId(cats[0].id);
    }
  };

  const selectedCategory = useMemo(
    () => categories.find((c) => c.id === categoryId) || null,
    [categoryId, categories]
  );

  const pickImage = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== "granted") {
        showToast("Photo library permission needed", "error");
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        base64: true,
        quality: 0.6,
      });
      if (!res.canceled && res.assets && res.assets[0]) {
        const a = res.assets[0];
        setReceipt(`data:${a.mimeType || "image/jpeg"};base64,${a.base64}`);
      }
    } catch (e) {
      showToast((e as Error).message, "error");
    }
  };

  const takePhoto = async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (perm.status !== "granted") {
        showToast("Camera permission needed", "error");
        return;
      }
      const res = await ImagePicker.launchCameraAsync({
        base64: true,
        quality: 0.6,
      });
      if (!res.canceled && res.assets && res.assets[0]) {
        const a = res.assets[0];
        setReceipt(`data:${a.mimeType || "image/jpeg"};base64,${a.base64}`);
      }
    } catch (e) {
      showToast((e as Error).message, "error");
    }
  };

  const save = async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      showToast("Enter a valid amount", "error");
      return;
    }
    if (!categoryId) {
      showToast("Select a category", "error");
      return;
    }
    setSaving(true);
    try {
      const body = {
        amount: amt,
        category_id: categoryId,
        subcategory_id: subcategoryId,
        note,
        date,
        receipt_base64: receipt,
      };
      if (mode === "edit" && expenseId) {
        await api.updateExpense(expenseId, body);
        showToast("Expense updated", "success");
      } else {
        await api.createExpense(body);
        showToast("Expense added", "success");
      }
      router.back();
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (mode !== "edit" || !expenseId) return;
    setDeleting(true);
    try {
      await api.deleteExpense(expenseId);
      showToast("Expense deleted", "success");
      router.back();
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingWrap} testID="expense-form-loading">
        <ActivityIndicator color={theme.colors.brand} />
      </View>
    );
  }

  return (
    <SafeAreaView edges={["top", "bottom"]} style={styles.safe} testID="expense-form-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="close-form-button">
          <Ionicons name="close" size={22} color={theme.colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {mode === "edit" ? "Edit expense" : "New expense"}
        </Text>
        {mode === "edit" ? (
          <TouchableOpacity onPress={remove} style={styles.iconBtn} testID="delete-expense-button">
            {deleting ? (
              <ActivityIndicator color={theme.colors.error} />
            ) : (
              <Ionicons name="trash-outline" size={22} color={theme.colors.error} />
            )}
          </TouchableOpacity>
        ) : (
          <View style={{ width: 36 }} />
        )}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 120 }}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.label}>Amount</Text>
          <View style={styles.amountRow}>
            <Text style={styles.currency}>₹</Text>
            <TextInput
              testID="amount-input"
              style={styles.amountInput}
              value={amount}
              onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ""))}
              placeholder="0"
              placeholderTextColor={theme.colors.textDim}
              keyboardType="decimal-pad"
              autoFocus={mode === "create"}
            />
          </View>

          <Text style={styles.label}>Category</Text>
          <TouchableOpacity
            testID="category-picker"
            onPress={() => setPickerOpen("category")}
            style={styles.selectRow}
          >
            {selectedCategory ? (
              <>
                <View style={[styles.dot, { backgroundColor: selectedCategory.color }]} />
                <Text style={styles.selectText}>{selectedCategory.name}</Text>
              </>
            ) : (
              <Text style={[styles.selectText, { color: theme.colors.textDim }]}>Select category</Text>
            )}
            <Ionicons name="chevron-forward" size={16} color={theme.colors.textDim} />
          </TouchableOpacity>

          {selectedCategory && selectedCategory.subcategories.length > 0 && (
            <>
              <Text style={styles.label}>Subcategory (optional)</Text>
              <TouchableOpacity
                testID="subcategory-picker"
                onPress={() => setPickerOpen("subcategory")}
                style={styles.selectRow}
              >
                <Text style={styles.selectText}>
                  {selectedCategory.subcategories.find((s) => s.id === subcategoryId)?.name || "None"}
                </Text>
                <Ionicons name="chevron-forward" size={16} color={theme.colors.textDim} />
              </TouchableOpacity>
            </>
          )}

          <Text style={styles.label}>Date</Text>
          <TextInput
            testID="date-input"
            style={styles.input}
            value={date}
            onChangeText={setDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.colors.textDim}
          />

          <Text style={styles.label}>Note</Text>
          <TextInput
            testID="note-input"
            style={[styles.input, { minHeight: 60 }]}
            value={note}
            onChangeText={setNote}
            placeholder="What was this for?"
            placeholderTextColor={theme.colors.textDim}
            multiline
          />

          <Text style={styles.label}>Receipt</Text>
          {receipt ? (
            <View style={styles.receiptWrap}>
              <Image source={{ uri: receipt }} style={styles.receiptImg} />
              <TouchableOpacity
                onPress={() => setReceipt(null)}
                style={styles.receiptRemove}
                testID="remove-receipt-button"
              >
                <Ionicons name="close" size={16} color={theme.colors.text} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.receiptRow}>
              <TouchableOpacity
                testID="camera-receipt-button"
                onPress={takePhoto}
                style={styles.receiptBtn}
              >
                <Ionicons name="camera-outline" size={20} color={theme.colors.brand} />
                <Text style={styles.receiptBtnText}>Camera</Text>
              </TouchableOpacity>
              <TouchableOpacity
                testID="gallery-receipt-button"
                onPress={pickImage}
                style={styles.receiptBtn}
              >
                <Ionicons name="image-outline" size={20} color={theme.colors.brand} />
                <Text style={styles.receiptBtnText}>Gallery</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            testID="save-expense-button"
            onPress={save}
            disabled={saving}
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color={theme.colors.onBrand} />
            ) : (
              <Text style={styles.saveBtnText}>
                {mode === "edit" ? "Save changes" : "Save expense"}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      <PickerModal
        visible={pickerOpen === "category"}
        title="Select category"
        options={categories.map((c) => ({ id: c.id, name: c.name, color: c.color }))}
        selected={categoryId}
        onClose={() => setPickerOpen(null)}
        onSelect={(id) => {
          setCategoryId(id);
          setSubcategoryId(null);
          setPickerOpen(null);
        }}
      />
      <PickerModal
        visible={pickerOpen === "subcategory"}
        title="Select subcategory"
        options={[
          { id: "", name: "None" },
          ...(selectedCategory?.subcategories.map((s) => ({ id: s.id, name: s.name })) || []),
        ]}
        selected={subcategoryId ?? ""}
        onClose={() => setPickerOpen(null)}
        onSelect={(id) => {
          setSubcategoryId(id ? id : null);
          setPickerOpen(null);
        }}
      />
    </SafeAreaView>
  );
}

function PickerModal({
  visible,
  title,
  options,
  selected,
  onClose,
  onSelect,
}: {
  visible: boolean;
  title: string;
  options: { id: string; name: string; color?: string }[];
  selected: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheetWrap} pointerEvents="box-none">
        <View style={styles.sheet} testID="picker-modal">
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{title}</Text>
          <ScrollView style={{ maxHeight: 400 }}>
            {options.map((o) => {
              const active = selected === o.id;
              return (
                <TouchableOpacity
                  key={o.id || "none"}
                  testID={`picker-option-${o.id || "none"}`}
                  onPress={() => onSelect(o.id)}
                  style={styles.optionRow}
                  activeOpacity={0.7}
                >
                  {o.color && <View style={[styles.dot, { backgroundColor: o.color }]} />}
                  <Text style={[styles.optionText, active && { color: theme.colors.brand, fontWeight: "700" }]}>
                    {o.name}
                  </Text>
                  {active && <Ionicons name="checkmark" size={18} color={theme.colors.brand} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  headerTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    color: theme.colors.textMuted,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 18,
    marginBottom: 8,
  },
  amountRow: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingBottom: 6,
  },
  currency: {
    color: theme.colors.textMuted,
    fontSize: 36,
    fontWeight: "700",
    marginRight: 8,
  },
  amountInput: {
    flex: 1,
    color: theme.colors.text,
    fontSize: 44,
    fontWeight: "800",
    letterSpacing: -1,
    padding: 0,
  },
  selectRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
    gap: 8,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  selectText: { flex: 1, color: theme.colors.text, fontSize: 15 },
  input: {
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    borderRadius: theme.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  receiptRow: { flexDirection: "row", gap: 12 },
  receiptBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: "dashed",
    backgroundColor: theme.colors.surface,
  },
  receiptBtnText: { color: theme.colors.brand, fontWeight: "600", fontSize: 14 },
  receiptWrap: {
    position: "relative",
    borderRadius: theme.radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  receiptImg: { width: "100%", height: 200 },
  receiptRemove: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.bg,
  },
  saveBtn: {
    height: 52,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: { color: theme.colors.onBrand, fontWeight: "700", fontSize: 15 },

  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.6)",
  },
  sheetWrap: {
    flex: 1,
    justifyContent: "flex-end",
  },
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
  sheetTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
  },
  optionText: { flex: 1, color: theme.colors.text, fontSize: 15 },
});
