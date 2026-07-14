import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";

import { api, Expense } from "@/src/api";
import { theme } from "@/src/theme";
import { formatINR } from "@/src/utils/currency";
import { showToast } from "@/src/components/Toast";

export default function Expenses() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const data = await api.listExpenses();
      setItems(data);
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onRefresh = () => {
    setRefreshing(true);
    void load(true);
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="expenses-screen">
      <View style={styles.header}>
        <Text style={styles.title}>Expenses</Text>
        <Text style={styles.subtitle}>{items.length} entries</Text>
      </View>

      {loading && items.length === 0 ? (
        <ActivityIndicator color={theme.colors.brand} style={{ marginTop: 40 }} />
      ) : items.length === 0 ? (
        <View style={styles.empty} testID="expenses-empty">
          <Ionicons name="receipt-outline" size={56} color={theme.colors.textDim} />
          <Text style={styles.emptyTitle}>No expenses yet</Text>
          <Text style={styles.emptyText}>Tap the + button to add your first entry.</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 140 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={theme.colors.brand}
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              testID={`expense-item-${item.id}`}
              style={styles.card}
              activeOpacity={0.75}
              onPress={() => router.push({ pathname: "/expense/edit", params: { id: item.id } })}
            >
              <View style={styles.thumbWrap}>
                {item.receipt_base64 ? (
                  <Image
                    source={{ uri: normalizeBase64(item.receipt_base64) }}
                    style={styles.thumb}
                  />
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
    </SafeAreaView>
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
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  title: {
    color: theme.colors.text,
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  subtitle: { color: theme.colors.textDim, fontSize: 13, marginTop: 2 },
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
  thumbPlaceholder: {
    backgroundColor: theme.colors.brandDim,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "600",
  },
  cardMeta: {
    color: theme.colors.textDim,
    fontSize: 12,
    marginTop: 2,
  },
  cardNote: {
    color: theme.colors.textMuted,
    fontSize: 12,
    marginTop: 2,
    fontStyle: "italic",
  },
  cardAmount: {
    color: theme.colors.text,
    fontSize: 15,
    fontWeight: "700",
    marginLeft: 12,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  emptyTitle: {
    color: theme.colors.text,
    fontSize: 18,
    fontWeight: "700",
    marginTop: 16,
  },
  emptyText: {
    color: theme.colors.textDim,
    fontSize: 14,
    marginTop: 6,
    textAlign: "center",
  },
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
});
