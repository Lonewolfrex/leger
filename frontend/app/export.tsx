import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { showToast } from "@/src/components/Toast";
import ScreenHeader from "@/src/components/ScreenHeader";

type Preset = { key: string; label: string; range: () => { start?: string; end?: string } };

function today(): Date {
  return new Date();
}
function fmt(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const PRESETS: Preset[] = [
  {
    key: "this_month",
    label: "This month",
    range: () => {
      const t = today();
      const start = new Date(t.getFullYear(), t.getMonth(), 1);
      const end = new Date(t.getFullYear(), t.getMonth() + 1, 0);
      return { start: fmt(start), end: fmt(end) };
    },
  },
  {
    key: "last_month",
    label: "Last month",
    range: () => {
      const t = today();
      const start = new Date(t.getFullYear(), t.getMonth() - 1, 1);
      const end = new Date(t.getFullYear(), t.getMonth(), 0);
      return { start: fmt(start), end: fmt(end) };
    },
  },
  {
    key: "this_year",
    label: "This year",
    range: () => {
      const t = today();
      return { start: `${t.getFullYear()}-01-01`, end: `${t.getFullYear()}-12-31` };
    },
  },
  {
    key: "financial_year",
    label: "Financial year (Apr-Mar)",
    range: () => {
      const t = today();
      const y = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1;
      return { start: `${y}-04-01`, end: `${y + 1}-03-31` };
    },
  },
  {
    key: "all",
    label: "All time",
    range: () => ({}),
  },
];

export default function ExportScreen() {
  const [preset, setPreset] = useState<string>("this_month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [busy, setBusy] = useState(false);

  const doExport = async () => {
    setBusy(true);
    try {
      let range: { start?: string; end?: string };
      if (preset === "custom") {
        if (customStart && !/^\d{4}-\d{2}-\d{2}$/.test(customStart)) {
          showToast("Start date must be YYYY-MM-DD", "error");
          setBusy(false);
          return;
        }
        if (customEnd && !/^\d{4}-\d{2}-\d{2}$/.test(customEnd)) {
          showToast("End date must be YYYY-MM-DD", "error");
          setBusy(false);
          return;
        }
        range = { start: customStart || undefined, end: customEnd || undefined };
      } else {
        const p = PRESETS.find((x) => x.key === preset)!;
        range = p.range();
      }

      const res = await api.exportCSV(range);
      if (res.count === 0) {
        showToast("No expenses in this range", "info");
        setBusy(false);
        return;
      }

      if (Platform.OS === "web") {
        // Trigger download in browser
        if (typeof window !== "undefined") {
          const blob = new Blob([res.content], { type: "text/csv" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = res.filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          showToast(`Exported ${res.count} rows`, "success");
        }
      } else {
        const path = `${FileSystem.cacheDirectory}${res.filename}`;
        await FileSystem.writeAsStringAsync(path, res.content, { encoding: FileSystem.EncodingType.UTF8 });
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(path, { mimeType: "text/csv", dialogTitle: "Share expenses CSV" });
          showToast(`Exported ${res.count} rows`, "success");
        } else {
          showToast(`Saved to ${path}`, "info");
        }
      }
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="export-screen">
      <ScreenHeader title="Export CSV" />
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60 }}>
        <Text style={styles.helper}>
          Download every expense in a range as a CSV — perfect for tax season, expense reports, or backing up your data.
        </Text>

        <View style={styles.iconRow}>
          <View style={styles.bigIcon}>
            <Ionicons name="document-text-outline" size={28} color={theme.colors.brand} />
          </View>
        </View>

        <Text style={styles.label}>Range</Text>
        {PRESETS.map((p) => (
          <TouchableOpacity
            key={p.key}
            testID={`export-preset-${p.key}`}
            onPress={() => setPreset(p.key)}
            activeOpacity={0.8}
            style={[styles.optionRow, preset === p.key && styles.optionRowActive]}
          >
            <Text style={[styles.optionText, preset === p.key && styles.optionTextActive]}>{p.label}</Text>
            {preset === p.key && <Ionicons name="checkmark" size={18} color={theme.colors.brand} />}
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          testID="export-preset-custom"
          onPress={() => setPreset("custom")}
          activeOpacity={0.8}
          style={[styles.optionRow, preset === "custom" && styles.optionRowActive]}
        >
          <Text style={[styles.optionText, preset === "custom" && styles.optionTextActive]}>Custom range</Text>
          {preset === "custom" && <Ionicons name="checkmark" size={18} color={theme.colors.brand} />}
        </TouchableOpacity>

        {preset === "custom" && (
          <View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
            <TextInput
              testID="export-start-input"
              style={[styles.input, { flex: 1 }]}
              value={customStart}
              onChangeText={setCustomStart}
              placeholder="Start YYYY-MM-DD"
              placeholderTextColor={theme.colors.textDim}
            />
            <TextInput
              testID="export-end-input"
              style={[styles.input, { flex: 1 }]}
              value={customEnd}
              onChangeText={setCustomEnd}
              placeholder="End YYYY-MM-DD"
              placeholderTextColor={theme.colors.textDim}
            />
          </View>
        )}

        <TouchableOpacity
          testID="export-download-button"
          onPress={doExport}
          disabled={busy}
          style={[styles.primary, busy && { opacity: 0.6 }]}
          activeOpacity={0.85}
        >
          {busy ? (
            <ActivityIndicator color={theme.colors.onBrand} />
          ) : (
            <>
              <Ionicons name="download-outline" size={18} color={theme.colors.onBrand} />
              <Text style={styles.primaryText}>Download CSV</Text>
            </>
          )}
        </TouchableOpacity>

        <Text style={styles.hint}>
          Columns: Date · Category · Subcategory · Amount (INR) · Paid By · Note. Opens directly in Excel, Google Sheets, or any accounting app.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  helper: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 20, marginBottom: 16 },
  iconRow: { alignItems: "center", marginBottom: 12 },
  bigIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: theme.colors.brandDim,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    color: theme.colors.textMuted,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 20,
    marginBottom: 8,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 14,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    marginBottom: 8,
  },
  optionRowActive: { borderColor: theme.colors.brand, backgroundColor: theme.colors.brandDim },
  optionText: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
  optionTextActive: { color: theme.colors.brand },
  input: {
    backgroundColor: theme.colors.surface2,
    color: theme.colors.text,
    borderRadius: theme.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  primary: {
    marginTop: 24,
    height: 52,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brand,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  primaryText: { color: theme.colors.onBrand, fontWeight: "700", fontSize: 15 },
  hint: { color: theme.colors.textDim, fontSize: 12, marginTop: 16, lineHeight: 18 },
});
