import React, { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { api } from "@/src/api";
import { theme } from "@/src/theme";
import { useSubscription } from "@/src/context/SubscriptionContext";
import ScreenHeader from "@/src/components/ScreenHeader";
import { showToast } from "@/src/components/Toast";

/**
 * Timeline + plan picker.
 * NOTE: In production, "Subscribe" would launch the native billing flow (Razorpay
 *   UPI AutoPay or Google Play Billing) and only mark the user as paid after the
 *   webhook / receipt verification. For MVP we mark paid directly after tap.
 */
export default function SubscriptionScreen() {
  const { status, refresh, loading: loadingStatus } = useSubscription();
  const router = useRouter();
  const [busy, setBusy] = useState<null | string>(null);

  const activate = async (plan: "monthly" | "annual" | "founding_annual") => {
    setBusy(plan);
    try {
      await api.activateSubscription(plan);
      await refresh();
      showToast("You're premium — thanks!", "success");
      router.back();
    } catch (e) {
      showToast((e as Error).message, "error");
    } finally {
      setBusy(null);
    }
  };

  if (loadingStatus || !status) {
    return (
      <SafeAreaView edges={["top"]} style={styles.safe}>
        <ScreenHeader title="Subscription" />
        <View style={styles.centered}>
          <ActivityIndicator color={theme.colors.brand} />
        </View>
      </SafeAreaView>
    );
  }

  const day = Math.max(0, status.days_since_start);
  const progressPct = Math.min(100, (day / 90) * 100);
  const paidActive = status.phase === "paid";

  return (
    <SafeAreaView edges={["top"]} style={styles.safe} testID="subscription-screen">
      <ScreenHeader title="Plans &amp; subscription" testID="subscription-header" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>{paidActive ? "You're premium" : "Your 90-day journey"}</Text>
        {paidActive ? (
          <Text style={styles.subheading}>
            Thanks for supporting the app. Renews on{" "}
            {status.subscription_expires_at
              ? new Date(status.subscription_expires_at).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })
              : "—"}
            .
          </Text>
        ) : (
          <Text style={styles.subheading}>
            30 days fully free · 60 days premium free · then ₹{status.price_monthly}/mo to keep premium.
          </Text>
        )}

        <View style={styles.timelineCard}>
          <View style={styles.timelineHeader}>
            <Text style={styles.timelineLabel}>Day {day} of 90</Text>
            <Text style={styles.phaseTag}>{phaseLabel(status.phase)}</Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
            <View style={[styles.milestone, { left: `${(30 / 90) * 100}%` }]} />
            <View style={[styles.milestone, { left: `${(90 / 90) * 100}%` }]} />
          </View>
          <View style={styles.milestoneLabels}>
            <MilestoneLabel dayLabel="Day 0" caption="All free" active={day >= 0} />
            <MilestoneLabel dayLabel="Day 30" caption="Premium unlocks" active={day >= 30} />
            <MilestoneLabel dayLabel="Day 90" caption="Subscribe" active={day >= 90} />
          </View>
        </View>

        {!paidActive && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Pick a plan</Text>
            </View>

            {status.founding_offer_available && (
              <PlanCard
                testID="plan-founding"
                highlight
                badge="Founding rate — locked forever"
                title="Founding Annual"
                priceLine={`₹${status.founding_annual_price} / year`}
                subline="≈ ₹12/month · price never increases while active"
                busy={busy === "founding_annual"}
                onPress={() => activate("founding_annual")}
              />
            )}
            <PlanCard
              testID="plan-annual"
              title="Annual"
              priceLine={`₹${status.price_annual} / year`}
              subline={`Saves ₹${status.price_monthly * 12 - status.price_annual}/yr vs monthly`}
              busy={busy === "annual"}
              onPress={() => activate("annual")}
            />
            <PlanCard
              testID="plan-monthly"
              title="Monthly"
              priceLine={`₹${status.price_monthly} / month`}
              subline="Cancel anytime"
              busy={busy === "monthly"}
              onPress={() => activate("monthly")}
            />

            <Text style={styles.disclaimer}>
              For MVP, plan activation is instant so you can try premium end-to-end. In the Play Store build this
              hooks into Google Play Billing (UPI AutoPay). Cancel anytime from the Play Store subscriptions
              screen.
            </Text>
          </>
        )}

        <View style={[styles.sectionHeader, { marginTop: 28 }]}>
          <Text style={styles.sectionTitle}>What&apos;s included</Text>
        </View>
        <BenefitRow icon="flag" text="Budget goals per category with over-spend alerts" />
        <BenefitRow icon="repeat" text="Recurring expenses (rent, EMI, subscriptions)" />
        <BenefitRow icon="notifications" text="Bill reminders with local notifications" />
        <BenefitRow icon="download" text="CSV export for tax season, accountants" />
        <BenefitRow icon="search" text="Advanced search &amp; filters" />
        <BenefitRow icon="people" text="Unlimited earners in your household" />
      </ScrollView>
    </SafeAreaView>
  );
}

function phaseLabel(p: string) {
  switch (p) {
    case "free":
      return "Free phase";
    case "premium_trial":
      return "Premium free";
    case "paid":
      return "Premium";
    case "expired":
      return "Trial ended";
    default:
      return "";
  }
}

function MilestoneLabel({ dayLabel, caption, active }: { dayLabel: string; caption: string; active: boolean }) {
  return (
    <View style={{ flex: 1, alignItems: "center" }}>
      <Text style={[styles.milestoneDay, active && { color: theme.colors.brand }]}>{dayLabel}</Text>
      <Text style={styles.milestoneCaption}>{caption}</Text>
    </View>
  );
}

function PlanCard({
  testID,
  highlight,
  badge,
  title,
  priceLine,
  subline,
  busy,
  onPress,
}: {
  testID: string;
  highlight?: boolean;
  badge?: string;
  title: string;
  priceLine: string;
  subline: string;
  busy: boolean;
  onPress: () => void;
}) {
  return (
    <View
      style={[
        styles.planCard,
        highlight && { borderColor: theme.colors.brand, backgroundColor: theme.colors.brandDim },
      ]}
      testID={testID}
    >
      {badge && (
        <View style={styles.badge}>
          <Ionicons name="star" size={11} color={theme.colors.warn} />
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      )}
      <Text style={[styles.planTitle, highlight && { color: theme.colors.brand }]}>{title}</Text>
      <Text style={[styles.planPrice, highlight && { color: theme.colors.text }]}>{priceLine}</Text>
      <Text style={styles.planSub}>{subline}</Text>
      <TouchableOpacity
        onPress={onPress}
        disabled={busy}
        style={[
          styles.planBtn,
          highlight ? { backgroundColor: theme.colors.brand } : { backgroundColor: theme.colors.surface2 },
          busy && { opacity: 0.6 },
        ]}
        activeOpacity={0.85}
      >
        {busy ? (
          <ActivityIndicator color={highlight ? theme.colors.onBrand : theme.colors.text} />
        ) : (
          <Text style={[styles.planBtnText, highlight ? { color: theme.colors.onBrand } : { color: theme.colors.text }]}>
            Choose
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

function BenefitRow({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.benefitRow}>
      <View style={styles.benefitIcon}>
        <Ionicons name={icon as never} size={16} color={theme.colors.brand} />
      </View>
      <Text style={styles.benefitText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.colors.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 20, paddingBottom: 60 },
  heading: { color: theme.colors.text, fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  subheading: { color: theme.colors.textMuted, fontSize: 14, marginTop: 6, lineHeight: 20 },
  timelineCard: {
    marginTop: 20,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 16,
  },
  timelineHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  timelineLabel: { color: theme.colors.text, fontSize: 14, fontWeight: "700" },
  phaseTag: {
    backgroundColor: theme.colors.brandDim,
    color: theme.colors.brand,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    fontSize: 11,
    fontWeight: "700",
    overflow: "hidden",
  },
  progressTrack: {
    height: 8,
    backgroundColor: theme.colors.surface2,
    borderRadius: 4,
    overflow: "visible",
    position: "relative",
  },
  progressFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: theme.colors.brand,
    borderRadius: 4,
  },
  milestone: {
    position: "absolute",
    top: -2,
    width: 2,
    height: 12,
    backgroundColor: theme.colors.textDim,
    marginLeft: -1,
  },
  milestoneLabels: { flexDirection: "row", marginTop: 10 },
  milestoneDay: { color: theme.colors.textMuted, fontSize: 11, fontWeight: "700" },
  milestoneCaption: { color: theme.colors.textDim, fontSize: 10, marginTop: 2 },

  sectionHeader: { marginTop: 24, marginBottom: 12 },
  sectionTitle: { color: theme.colors.text, fontSize: 16, fontWeight: "700" },

  planCard: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 16,
    marginBottom: 12,
  },
  badge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: theme.colors.warn + "22",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.radius.pill,
    marginBottom: 8,
  },
  badgeText: { color: theme.colors.warn, fontSize: 10, fontWeight: "700" },
  planTitle: { color: theme.colors.text, fontSize: 14, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  planPrice: { color: theme.colors.text, fontSize: 24, fontWeight: "800", marginTop: 6 },
  planSub: { color: theme.colors.textMuted, fontSize: 12, marginTop: 4 },
  planBtn: {
    marginTop: 12,
    height: 44,
    borderRadius: theme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  planBtnText: { fontWeight: "700", fontSize: 14 },
  disclaimer: {
    marginTop: 12,
    color: theme.colors.textDim,
    fontSize: 11,
    lineHeight: 16,
    fontStyle: "italic",
  },
  benefitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 8,
  },
  benefitIcon: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: theme.colors.brandDim,
    alignItems: "center",
    justifyContent: "center",
  },
  benefitText: { flex: 1, color: theme.colors.text, fontSize: 13, lineHeight: 18 },
});
