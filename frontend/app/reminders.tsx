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
import * as Notifications from "expo-notifications";

import { api, Reminder } from "@/src/api";
import { theme } from "@/src/theme";
import { formatINR } from "@/src/utils/currency";
import { showToast } from "@/src/components/Toast";
import ScreenHeader from "@/src/components/ScreenHeader";
import { storage } from "@/src/utils/storage";

const NOTIF_MAP_KEY = "reminder_notif_map_v1"; // reminder_id -> notif_id string

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function loadMap(): Promise<Record<string, string>> {
  const raw = await storage.getItem<string>(NOTIF_MAP_KEY, "");
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}
async function saveMap(m: Record<string, string>) {
  await storage.setItem(NOTIF_MAP_KEY, JSON.stringify(m));
}

async function ensurePermission(): Promise<boolean> {
  const settings = await Notifications.getPermissionsAsync();
  if (settings.granted) return true;
  if (!settings.canAskAgain) return false;
  const req = await Notifications.requestPermissionsAsync();
  return req.granted;
}

async function scheduleReminderNotif(r: Reminder): Promise<string | null> {
  try {
    const [y, m, d] = r.due_date.split("-").map(Number);
    // Fire 9am on the due date; skip if in the past
    const date = new Date(y, (m || 1) - 1, d || 1, 9, 0, 0);
    if (date.getTime() <= Date.now()) return null;
    const notifId = await Notifications.scheduleNotificationAsync({
      content: {
        title: `${r.title} due today`,
        body: r.amount ? `Amount: ${formatINR(r.amount)}` : "Tap to log the expense.",
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date } as unknown as Notifications.NotificationTriggerInput,
    });
    return notifId;
  } catch {
    return null;
  }
}

export default function RemindersScreen() {
  const [items, setItems] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Reminder | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.listReminders();
      setItems(r);
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const onDelete = async (id: string) => {
    try {
      await api.deleteReminder(id);
      const m = await loadMap();
      if (m[id]) {
        await Notifications.cancelScheduledNotificationAsync(m[id]).catch(() => {});
        delete m[id];
        await saveMap(m);
      }
      showToast("Reminder removed", "success");
      void load();
    } catch (e) {
      showToast((e as Error).message, "error");
    }
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="reminders-screen">
      <ScreenHeader
        title="Bill reminders"
        right={
          <TouchableOpacity testID="add-reminder-button" onPress={() => setCreating(true)} style={styles.iconBtn}>
            <Ionicons name="add" size={22} color={theme.colors.text} />
          </TouchableOpacity>
        }
      />

      {loading ? (
        <ActivityIndicator color={theme.colors.brand} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 80 }}>
          <Text style={styles.helper}>
            Get a local notification at 9am on the due date. Works fully offline — nothing is pushed from a server.
          </Text>

          {items.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="notifications-outline" size={40} color={theme.colors.textDim} />
              <Text style={styles.emptyText}>No reminders yet.</Text>
              <TouchableOpacity onPress={() => setCreating(true)} style={styles.emptyBtn} testID="add-first-reminder">
                <Text style={styles.emptyBtnText}>Add first reminder</Text>
              </TouchableOpacity>
            </View>
          ) : (
            items.map((r) => (
              <TouchableOpacity
                key={r.id}
                onPress={() => setEditing(r)}
                activeOpacity={0.75}
                style={styles.card}
                testID={`reminder-item-${r.id}`}
              >
                <View style={styles.rowTop}>
                  <View style={styles.leadingIcon}>
                    <Ionicons name="alarm" size={18} color={theme.colors.brand} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{r.title}</Text>
                    <Text style={styles.meta}>
                      Due {r.due_date}
                      {r.repeat === "monthly" ? " · monthly" : ""}
                    </Text>
                  </View>
                  {r.amount != null && <Text style={styles.amount}>{formatINR(r.amount)}</Text>}
                  <TouchableOpacity onPress={() => onDelete(r.id)} style={styles.iconBtn} testID={`delete-reminder-${r.id}`}>
                    <Ionicons name="trash-outline" size={18} color={theme.colors.error} />
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      )}

      <ReminderModal
        visible={creating || !!editing}
        reminder={editing}
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

function ReminderModal({
  visible,
  reminder,
  onClose,
  onSaved,
}: {
  visible: boolean;
  reminder: Reminder | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [repeat, setRepeat] = useState<"none" | "monthly">("none");
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (visible) {
      setTitle(reminder?.title ?? "");
      setAmount(reminder?.amount ? String(reminder.amount) : "");
      setDueDate(reminder?.due_date ?? new Date().toISOString().slice(0, 10));
      setRepeat(reminder?.repeat ?? "none");
    }
  }, [visible, reminder]);

  const save = async () => {
    if (!title.trim()) {
      showToast("Enter a title", "error");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      showToast("Date must be YYYY-MM-DD", "error");
      return;
    }
    setSaving(true);
    try {
      const body = {
        title: title.trim(),
        amount: amount ? parseFloat(amount) : null,
        due_date: dueDate,
        repeat,
      };
      const saved = reminder
        ? await api.updateReminder(reminder.id, body)
        : await api.createReminder(body);

      // Try to schedule a local notification (best effort)
      const granted = await ensurePermission();
      if (granted) {
        const m = await loadMap();
        if (m[saved.id]) {
          await Notifications.cancelScheduledNotificationAsync(m[saved.id]).catch(() => {});
          delete m[saved.id];
        }
        const notifId = await scheduleReminderNotif(saved);
        if (notifId) m[saved.id] = notifId;
        await saveMap(m);
      } else {
        showToast("Enable notifications in Settings to get alerts", "info");
      }
      showToast(reminder ? "Reminder updated" : "Reminder added", "success");
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
        <View style={styles.sheet} testID="reminder-modal">
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>{reminder ? "Edit reminder" : "New reminder"}</Text>

          <Text style={styles.label}>Title</Text>
          <TextInput
            testID="reminder-title-input"
            style={styles.input}
            value={title}
            onChangeText={setTitle}
            placeholder="e.g. Electricity bill"
            placeholderTextColor={theme.colors.textDim}
            autoFocus
          />

          <Text style={styles.label}>Amount (₹, optional)</Text>
          <TextInput
            testID="reminder-amount-input"
            style={styles.input}
            value={amount}
            onChangeText={(v) => setAmount(v.replace(/[^0-9.]/g, ""))}
            placeholder="e.g. 2400"
            placeholderTextColor={theme.colors.textDim}
            keyboardType="decimal-pad"
          />

          <Text style={styles.label}>Due date</Text>
          <TextInput
            testID="reminder-date-input"
            style={styles.input}
            value={dueDate}
            onChangeText={setDueDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.colors.textDim}
          />

          <Text style={styles.label}>Repeat</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            {(["none", "monthly"] as const).map((r) => (
              <TouchableOpacity
                key={r}
                testID={`reminder-repeat-${r}`}
                onPress={() => setRepeat(r)}
                style={[styles.freqBtn, repeat === r && styles.freqBtnActive]}
              >
                <Text style={[styles.freqText, repeat === r && styles.freqTextActive]}>
                  {r === "none" ? "One-time" : "Monthly"}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <TouchableOpacity
            testID="save-reminder-button"
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
  rowTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  leadingIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: theme.colors.brandDim,
    alignItems: "center",
    justifyContent: "center",
  },
  name: { color: theme.colors.text, fontSize: 15, fontWeight: "600" },
  meta: { color: theme.colors.textDim, fontSize: 12, marginTop: 2 },
  amount: { color: theme.colors.text, fontSize: 14, fontWeight: "700" },
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
