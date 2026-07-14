import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";

import { api, Category } from "@/src/api";
import { theme } from "@/src/theme";
import { showToast } from "@/src/components/Toast";

const COLOR_SWATCHES = ["#34D399", "#FBBF24", "#A78BFA", "#60A5FA", "#F87171", "#F472B6", "#22D3EE", "#FB923C"];
const ICON_CHOICES = [
  "pricetag", "cart", "flash", "home", "car", "restaurant",
  "medkit", "game-controller", "airplane", "gift", "school", "briefcase",
];

export default function Categories() {
  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);
  const [subModal, setSubModal] = useState<{ category: Category; sub?: { id: string; name: string } } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.listCategories();
      setItems(d);
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onDelete = async (id: string) => {
    try {
      await api.deleteCategory(id);
      showToast("Category deleted", "success");
      void load();
    } catch (e) {
      showToast((e as Error).message, "error");
    }
  };

  const onDeleteSub = async (categoryId: string, subId: string) => {
    try {
      await api.deleteSubcategory(categoryId, subId);
      showToast("Subcategory deleted", "success");
      void load();
    } catch (e) {
      showToast((e as Error).message, "error");
    }
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="categories-screen">
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Categories</Text>
          <Text style={styles.subtitle}>{items.length} groups</Text>
        </View>
        <TouchableOpacity
          testID="add-category-button"
          style={styles.addBtn}
          onPress={() => setCreating(true)}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={18} color={theme.colors.onBrand} />
          <Text style={styles.addBtnText}>New</Text>
        </TouchableOpacity>
      </View>

      {loading && items.length === 0 ? (
        <ActivityIndicator color={theme.colors.brand} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
          renderItem={({ item }) => {
            const isOpen = !!expanded[item.id];
            return (
              <View style={styles.card} testID={`category-${item.id}`}>
                <View style={styles.catHeader}>
                  <View style={[styles.catIcon, { backgroundColor: item.color + "22" }]}>
                    <Ionicons name={item.icon as never} size={18} color={item.color} />
                  </View>
                  <TouchableOpacity
                    style={{ flex: 1 }}
                    onPress={() => setExpanded((e) => ({ ...e, [item.id]: !e[item.id] }))}
                  >
                    <Text style={styles.catName}>{item.name}</Text>
                    <Text style={styles.catMeta}>
                      {item.subcategories.length} subcategories
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID={`edit-category-${item.id}`}
                    onPress={() => setEditing(item)}
                    style={styles.iconBtn}
                  >
                    <Ionicons name="create-outline" size={18} color={theme.colors.textMuted} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    testID={`delete-category-${item.id}`}
                    onPress={() => onDelete(item.id)}
                    style={styles.iconBtn}
                  >
                    <Ionicons name="trash-outline" size={18} color={theme.colors.error} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setExpanded((e) => ({ ...e, [item.id]: !e[item.id] }))}
                    style={styles.iconBtn}
                  >
                    <Ionicons
                      name={isOpen ? "chevron-up" : "chevron-down"}
                      size={18}
                      color={theme.colors.textDim}
                    />
                  </TouchableOpacity>
                </View>
                {isOpen && (
                  <View style={styles.subList}>
                    {item.subcategories.map((s) => (
                      <View key={s.id} style={styles.subRow} testID={`subcat-${s.id}`}>
                        <View style={styles.subBullet} />
                        <Text style={styles.subName}>{s.name}</Text>
                        <TouchableOpacity
                          onPress={() => setSubModal({ category: item, sub: s })}
                          style={styles.iconBtn}
                        >
                          <Ionicons name="create-outline" size={16} color={theme.colors.textMuted} />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => onDeleteSub(item.id, s.id)} style={styles.iconBtn}>
                          <Ionicons name="close" size={16} color={theme.colors.error} />
                        </TouchableOpacity>
                      </View>
                    ))}
                    <TouchableOpacity
                      testID={`add-subcategory-${item.id}`}
                      onPress={() => setSubModal({ category: item })}
                      style={styles.addSubBtn}
                    >
                      <Ionicons name="add" size={16} color={theme.colors.brand} />
                      <Text style={styles.addSubText}>Add subcategory</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          }}
        />
      )}

      <CategoryModal
        visible={creating || !!editing}
        category={editing}
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

      <SubcategoryModal
        state={subModal}
        onClose={() => setSubModal(null)}
        onSaved={() => {
          setSubModal(null);
          void load();
        }}
      />
    </SafeAreaView>
  );
}

function CategoryModal({
  visible,
  category,
  onClose,
  onSaved,
}: {
  visible: boolean;
  category: Category | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("pricetag");
  const [color, setColor] = useState("#34D399");
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (visible) {
      setName(category?.name ?? "");
      setIcon(category?.icon ?? "pricetag");
      setColor(category?.color ?? "#34D399");
    }
  }, [visible, category]);

  const save = async () => {
    if (!name.trim()) {
      showToast("Please enter a name", "error");
      return;
    }
    setSaving(true);
    try {
      if (category) {
        await api.updateCategory(category.id, { name, icon, color });
        showToast("Category updated", "success");
      } else {
        await api.createCategory({ name, icon, color });
        showToast("Category created", "success");
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
        <View style={styles.sheet} testID="category-modal">
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{category ? "Edit category" : "New category"}</Text>

          <Text style={styles.label}>Name</Text>
          <TextInput
            testID="category-name-input"
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Groceries"
            placeholderTextColor={theme.colors.textDim}
            autoFocus
          />

          <Text style={styles.label}>Icon</Text>
          <View style={styles.iconGrid}>
            {ICON_CHOICES.map((ic) => (
              <TouchableOpacity
                key={ic}
                onPress={() => setIcon(ic)}
                style={[styles.iconChip, icon === ic && { borderColor: color, backgroundColor: color + "22" }]}
              >
                <Ionicons name={ic as never} size={18} color={icon === ic ? color : theme.colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Color</Text>
          <View style={styles.iconGrid}>
            {COLOR_SWATCHES.map((c) => (
              <TouchableOpacity
                key={c}
                onPress={() => setColor(c)}
                style={[styles.colorSwatch, { backgroundColor: c }, color === c && styles.colorSelected]}
              />
            ))}
          </View>

          <TouchableOpacity
            testID="save-category-button"
            onPress={save}
            disabled={saving}
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color={theme.colors.onBrand} />
            ) : (
              <Text style={styles.saveBtnText}>{category ? "Save changes" : "Create"}</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function SubcategoryModal({
  state,
  onClose,
  onSaved,
}: {
  state: { category: Category; sub?: { id: string; name: string } } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    setName(state?.sub?.name ?? "");
  }, [state]);

  const save = async () => {
    if (!state) return;
    if (!name.trim()) {
      showToast("Please enter a name", "error");
      return;
    }
    setSaving(true);
    try {
      if (state.sub) {
        await api.updateSubcategory(state.category.id, state.sub.id, name);
        showToast("Subcategory updated", "success");
      } else {
        await api.addSubcategory(state.category.id, name);
        showToast("Subcategory added", "success");
      }
      onSaved();
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={!!state} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.sheetWrap}
        pointerEvents="box-none"
      >
        <View style={styles.sheet} testID="subcategory-modal">
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>
            {state?.sub ? "Edit subcategory" : `New subcategory in ${state?.category.name || ""}`}
          </Text>
          <TextInput
            testID="subcategory-name-input"
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Vegetables"
            placeholderTextColor={theme.colors.textDim}
            autoFocus
          />
          <TouchableOpacity
            testID="save-subcategory-button"
            onPress={save}
            disabled={saving}
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            activeOpacity={0.85}
          >
            {saving ? (
              <ActivityIndicator color={theme.colors.onBrand} />
            ) : (
              <Text style={styles.saveBtnText}>{state?.sub ? "Save" : "Add"}</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  title: {
    color: theme.colors.text,
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  subtitle: { color: theme.colors.textDim, fontSize: 13, marginTop: 2 },
  addBtn: {
    flexDirection: "row",
    backgroundColor: theme.colors.brand,
    paddingHorizontal: 14,
    height: 36,
    alignItems: "center",
    borderRadius: theme.radius.pill,
    gap: 4,
  },
  addBtnText: { color: theme.colors.onBrand, fontWeight: "700", fontSize: 13 },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  catHeader: { flexDirection: "row", alignItems: "center" },
  catIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  catName: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
  catMeta: { color: theme.colors.textDim, fontSize: 12, marginTop: 2 },
  iconBtn: { padding: 6, marginLeft: 2 },
  subList: {
    marginTop: 8,
    paddingLeft: 48,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  subRow: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  subBullet: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.textDim,
    marginRight: 10,
  },
  subName: { flex: 1, color: theme.colors.textMuted, fontSize: 13 },
  addSubBtn: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    gap: 4,
  },
  addSubText: { color: theme.colors.brand, fontSize: 13, fontWeight: "600" },
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
    marginBottom: 16,
  },
  label: {
    color: theme.colors.textMuted,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 8,
    marginBottom: 6,
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
  iconGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 6,
  },
  iconChip: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  colorSwatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "transparent",
  },
  colorSelected: { borderColor: theme.colors.text },
  saveBtn: {
    marginTop: 20,
    height: 52,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: {
    color: theme.colors.onBrand,
    fontWeight: "700",
    fontSize: 15,
  },
});
