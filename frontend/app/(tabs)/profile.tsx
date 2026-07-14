import React, { useCallback, useState } from "react";
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
import { useFocusEffect, useRouter } from "expo-router";
import * as Clipboard from "expo-clipboard";

import { api, Household } from "@/src/api";
import { theme } from "@/src/theme";
import { showToast } from "@/src/components/Toast";
import { useAuth } from "@/src/context/AuthContext";
import { useSubscription } from "@/src/context/SubscriptionContext";
import PremiumBanner from "@/src/components/PremiumBanner";
import LockedFeatureSheet from "@/src/components/LockedFeatureSheet";

type Feature = { key: string; title: string; icon: string; route: "/budgets" | "/recurring" | "/reminders" | "/export" };
const PREMIUM_FEATURES: Feature[] = [
  { key: "budgets", title: "Budget goals", icon: "flag", route: "/budgets" },
  { key: "recurring", title: "Recurring expenses", icon: "repeat", route: "/recurring" },
  { key: "reminders", title: "Bill reminders", icon: "notifications", route: "/reminders" },
  { key: "export", title: "Export CSV", icon: "download", route: "/export" },
];

export default function Profile() {
  const { user, signOut } = useAuth();
  const { status, isPremiumActive } = useSubscription();
  const router = useRouter();
  const [hh, setHh] = useState<Household | null>(null);
  const [loading, setLoading] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);
  const [lockedName, setLockedName] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.getHousehold();
      setHh(d);
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const copyCode = async () => {
    if (!hh) return;
    try {
      await Clipboard.setStringAsync(hh.invite_code);
      showToast("Invite code copied", "success");
    } catch {
      showToast(hh.invite_code, "info");
    }
  };

  const openFeature = (f: Feature) => {
    if (!isPremiumActive) {
      setLockedName(f.title);
      return;
    }
    router.push(f.route);
  };

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="profile-screen">
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
        <Text style={styles.title}>Profile</Text>

        <View style={styles.userCard} testID="profile-user-card">
          <View style={styles.avatarBig}>
            {user?.picture ? (
              <Image source={{ uri: user.picture }} style={styles.avatarImg} />
            ) : (
              <Text style={styles.avatarBigText}>{initials(user?.name || "?")}</Text>
            )}
          </View>
          <Text style={styles.userName}>{user?.name}</Text>
          <Text style={styles.userEmail}>{user?.email}</Text>
          {status?.is_founding_member && (
            <View style={styles.foundingBadge}>
              <Ionicons name="star" size={12} color={theme.colors.warn} />
              <Text style={styles.foundingBadgeText}>Founding member</Text>
            </View>
          )}
        </View>

        <PremiumBanner />

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Premium features</Text>
          {PREMIUM_FEATURES.map((f) => (
            <TouchableOpacity
              key={f.key}
              testID={`premium-feature-${f.key}`}
              onPress={() => openFeature(f)}
              activeOpacity={0.75}
              style={styles.featureRow}
            >
              <View style={styles.featureIcon}>
                <Ionicons name={f.icon as never} size={18} color={theme.colors.brand} />
              </View>
              <Text style={styles.featureTitle}>{f.title}</Text>
              {!isPremiumActive ? (
                <Ionicons name="lock-closed" size={14} color={theme.colors.warn} />
              ) : (
                <Ionicons name="chevron-forward" size={16} color={theme.colors.textDim} />
              )}
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            testID="see-plans-row"
            onPress={() => router.push("/subscription")}
            activeOpacity={0.75}
            style={[styles.featureRow, { borderBottomWidth: 0 }]}
          >
            <View style={[styles.featureIcon, { backgroundColor: theme.colors.warn + "22" }]}>
              <Ionicons name="sparkles" size={18} color={theme.colors.warn} />
            </View>
            <Text style={styles.featureTitle}>Plans &amp; subscription</Text>
            <Ionicons name="chevron-forward" size={16} color={theme.colors.textDim} />
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Household</Text>
          {loading && !hh ? (
            <ActivityIndicator color={theme.colors.brand} />
          ) : hh ? (
            <>
              <View style={styles.householdRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.hhName}>{hh.name}</Text>
                  <Text style={styles.hhMeta}>
                    {hh.members.length} {hh.members.length === 1 ? "member" : "members"}
                  </Text>
                </View>
                <TouchableOpacity onPress={copyCode} style={styles.codeBtn} testID="copy-invite-code">
                  <Ionicons name="copy-outline" size={16} color={theme.colors.brand} />
                  <Text style={styles.codeText}>{hh.invite_code}</Text>
                </TouchableOpacity>
              </View>

              {hh.members.map((m) => (
                <View key={m.user_id} style={styles.memberRow} testID={`member-${m.user_id}`}>
                  <View style={styles.memberAvatar}>
                    {m.picture ? (
                      <Image source={{ uri: m.picture }} style={styles.avatarImg} />
                    ) : (
                      <Text style={styles.memberAvatarText}>{initials(m.name)}</Text>
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.memberName}>{m.name}</Text>
                    <Text style={styles.memberEmail}>{m.email}</Text>
                  </View>
                  {m.user_id === user?.user_id && (
                    <View style={styles.youChip}>
                      <Text style={styles.youChipText}>You</Text>
                    </View>
                  )}
                </View>
              ))}

              <TouchableOpacity
                testID="join-household-button"
                onPress={() => setJoinOpen(true)}
                style={styles.joinBtn}
                activeOpacity={0.85}
              >
                <Ionicons name="enter-outline" size={18} color={theme.colors.brand} />
                <Text style={styles.joinBtnText}>Join another household</Text>
              </TouchableOpacity>
            </>
          ) : null}
        </View>

        <TouchableOpacity
          testID="sign-out-button"
          onPress={signOut}
          style={styles.signOut}
          activeOpacity={0.85}
        >
          <Ionicons name="log-out-outline" size={18} color={theme.colors.error} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
      </ScrollView>

      <JoinModal
        visible={joinOpen}
        onClose={() => setJoinOpen(false)}
        onSaved={() => {
          setJoinOpen(false);
          void load();
        }}
      />
      <LockedFeatureSheet
        visible={!!lockedName}
        featureName={lockedName || ""}
        onClose={() => setLockedName(null)}
      />
    </SafeAreaView>
  );
}

function JoinModal({
  visible,
  onClose,
  onSaved,
}: {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [code, setCode] = useState("");
  const [saving, setSaving] = useState(false);

  React.useEffect(() => {
    if (visible) setCode("");
  }, [visible]);

  const submit = async () => {
    if (!code.trim()) {
      showToast("Enter an invite code", "error");
      return;
    }
    setSaving(true);
    try {
      await api.joinHousehold(code.trim());
      showToast("Joined household", "success");
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
        <View style={styles.sheet} testID="join-household-modal">
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Join a household</Text>
          <Text style={styles.helpText}>
            Ask another earner to share their invite code from the Profile tab, then paste it below.
          </Text>
          <TextInput
            testID="invite-code-input"
            style={styles.input}
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            placeholder="INVITE CODE"
            placeholderTextColor={theme.colors.textDim}
            autoCapitalize="characters"
            autoFocus
          />
          <TouchableOpacity
            testID="submit-join-button"
            onPress={submit}
            disabled={saving}
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            activeOpacity={0.85}
          >
            {saving ? <ActivityIndicator color={theme.colors.onBrand} /> : <Text style={styles.saveBtnText}>Join</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  title: { color: theme.colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  userCard: {
    alignItems: "center",
    padding: 20,
    marginTop: 20,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  avatarBig: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: theme.colors.brandDim,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImg: { width: "100%", height: "100%" },
  avatarBigText: { color: theme.colors.brand, fontSize: 28, fontWeight: "700" },
  userName: { color: theme.colors.text, fontSize: 18, fontWeight: "700", marginTop: 12 },
  userEmail: { color: theme.colors.textMuted, fontSize: 13, marginTop: 4 },
  foundingBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.warn + "22",
  },
  foundingBadgeText: { color: theme.colors.warn, fontSize: 11, fontWeight: "700" },
  section: {
    marginTop: 20,
    padding: 16,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  sectionTitle: { color: theme.colors.text, fontSize: 15, fontWeight: "700", marginBottom: 8 },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.divider,
  },
  featureIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.brandDim,
    marginRight: 12,
  },
  featureTitle: { flex: 1, color: theme.colors.text, fontSize: 14, fontWeight: "600" },
  householdRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  hhName: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },
  hhMeta: { color: theme.colors.textDim, fontSize: 12, marginTop: 2 },
  codeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: theme.colors.brandDim,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: theme.radius.pill,
  },
  codeText: { color: theme.colors.brand, fontWeight: "700", fontSize: 12, letterSpacing: 1 },
  memberRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: theme.colors.brandDim,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    overflow: "hidden",
  },
  memberAvatarText: { color: theme.colors.brand, fontWeight: "700", fontSize: 13 },
  memberName: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
  memberEmail: { color: theme.colors.textDim, fontSize: 12, marginTop: 2 },
  youChip: {
    backgroundColor: theme.colors.brandDim,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
  },
  youChipText: { color: theme.colors.brand, fontSize: 11, fontWeight: "700" },
  joinBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 12,
    padding: 12,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderStyle: "dashed",
    justifyContent: "center",
  },
  joinBtnText: { color: theme.colors.brand, fontWeight: "600", fontSize: 13 },
  signOut: {
    marginTop: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 16,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.error + "44",
  },
  signOutText: { color: theme.colors.error, fontWeight: "700", fontSize: 14 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)" },
  sheetWrap: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 32,
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
  helpText: { color: theme.colors.textMuted, fontSize: 13, marginBottom: 12 },
  input: {
    backgroundColor: theme.colors.surface2,
    color: theme.colors.text,
    borderRadius: theme.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    letterSpacing: 2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    textAlign: "center",
  },
  saveBtn: {
    marginTop: 16,
    height: 52,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtnText: { color: theme.colors.onBrand, fontWeight: "700", fontSize: 15 },
});
