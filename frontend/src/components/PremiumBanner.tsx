import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { theme } from "@/src/theme";
import { useSubscription } from "@/src/context/SubscriptionContext";

/**
 * Sticky banner shown on all main tabs to communicate the 90-day trial timeline.
 * - phase "free" (day 0-29):    "Premium unlocks in X days"
 * - phase "premium_trial":      "Free premium ends in X days — lock ₹149/yr" (or ₹15/mo)
 * - phase "paid":               nothing
 * - phase "expired":            "Trial ended — subscribe for ₹15/mo"
 */
export default function PremiumBanner() {
  const { status } = useSubscription();
  const router = useRouter();
  if (!status) return null;
  if (status.phase === "paid") return null;

  let title = "";
  let subtitle = "";
  let cta = "See plans";
  let tone: "info" | "warn" | "danger" = "info";

  if (status.phase === "free") {
    title = `Premium unlocks in ${status.days_until_next_phase} ${status.days_until_next_phase === 1 ? "day" : "days"}`;
    subtitle = "Then 60 days of premium free, no card needed";
    tone = "info";
  } else if (status.phase === "premium_trial") {
    title = `Premium free for ${status.days_until_next_phase} more ${status.days_until_next_phase === 1 ? "day" : "days"}`;
    if (status.founding_offer_available) {
      subtitle = `Lock ₹${status.founding_annual_price}/yr forever — founding rate`;
      cta = "Lock rate";
    } else {
      subtitle = `Then ₹${status.price_monthly}/mo or ₹${status.price_annual}/yr`;
      cta = "See plans";
    }
    tone = "warn";
  } else if (status.phase === "expired") {
    title = "Trial ended";
    subtitle = `Continue for ₹${status.price_monthly}/mo — keep budgets, exports, reminders`;
    cta = "Subscribe";
    tone = "danger";
  }

  const bg =
    tone === "info"
      ? theme.colors.surface
      : tone === "warn"
      ? "#3a2a08"
      : "#3a0f10";
  const border =
    tone === "info"
      ? theme.colors.border
      : tone === "warn"
      ? theme.colors.warn + "55"
      : theme.colors.error + "55";
  const iconName = tone === "danger" ? "lock-closed" : tone === "warn" ? "flash" : "sparkles";
  const iconColor =
    tone === "info" ? theme.colors.brand : tone === "warn" ? theme.colors.warn : theme.colors.error;

  return (
    <TouchableOpacity
      testID="premium-banner"
      onPress={() => router.push("/subscription")}
      activeOpacity={0.85}
      style={[styles.banner, { backgroundColor: bg, borderColor: border }]}
    >
      <View style={styles.iconWrap}>
        <Ionicons name={iconName} size={18} color={iconColor} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <View style={styles.ctaChip}>
        <Text style={styles.ctaText}>{cta}</Text>
        <Ionicons name="chevron-forward" size={14} color={theme.colors.text} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 8,
    padding: 12,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    gap: 12,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: theme.colors.text, fontSize: 13, fontWeight: "700" },
  subtitle: { color: theme.colors.textMuted, fontSize: 11, marginTop: 2 },
  ctaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surface2,
  },
  ctaText: { color: theme.colors.text, fontSize: 12, fontWeight: "700" },
});
