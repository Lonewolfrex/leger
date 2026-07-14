import React from "react";
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { theme } from "@/src/theme";
import { useSubscription } from "@/src/context/SubscriptionContext";

/**
 * Small "premium locked" sheet used when a free-phase user taps a premium feature.
 */
export default function LockedFeatureSheet({
  visible,
  featureName,
  onClose,
}: {
  visible: boolean;
  featureName: string;
  onClose: () => void;
}) {
  const { status } = useSubscription();
  const router = useRouter();
  if (!status) return null;

  const isFreePhase = status.phase === "free";
  const isExpired = status.phase === "expired";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.wrap} pointerEvents="box-none">
        <View style={styles.sheet} testID="locked-feature-sheet">
          <View style={styles.handle} />
          <View style={styles.iconWrap}>
            <Ionicons name={isFreePhase ? "hourglass-outline" : "lock-closed"} size={22} color={theme.colors.brand} />
          </View>
          <Text style={styles.title}>{featureName} is premium</Text>
          {isFreePhase ? (
            <Text style={styles.body}>
              This unlocks free for everyone in{" "}
              <Text style={styles.strong}>
                {status.days_until_next_phase} {status.days_until_next_phase === 1 ? "day" : "days"}
              </Text>
              . You&apos;ll then get 60 days of premium free, no card needed.
            </Text>
          ) : isExpired ? (
            <Text style={styles.body}>
              Your 90-day free premium period has ended. Continue for ₹{status.price_monthly}/month or ₹{status.price_annual}/year to keep {featureName.toLowerCase()} and other premium features.
            </Text>
          ) : (
            <Text style={styles.body}>{featureName} is included in premium.</Text>
          )}

          <TouchableOpacity
            testID="locked-see-plans-button"
            onPress={() => {
              onClose();
              router.push("/subscription");
            }}
            style={styles.primary}
            activeOpacity={0.85}
          >
            <Text style={styles.primaryText}>{isExpired ? "Subscribe" : "See plans"}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} style={styles.secondary} activeOpacity={0.7}>
            <Text style={styles.secondaryText}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.6)" },
  wrap: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    paddingBottom: 40,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    backgroundColor: theme.colors.border,
    borderRadius: 2,
    marginBottom: 16,
  },
  iconWrap: {
    alignSelf: "center",
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.brandDim,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  title: {
    color: theme.colors.text,
    fontSize: 20,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: -0.5,
  },
  body: {
    color: theme.colors.textMuted,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 20,
    marginTop: 8,
    marginBottom: 24,
  },
  strong: { color: theme.colors.text, fontWeight: "700" },
  primary: {
    height: 52,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: theme.colors.onBrand, fontWeight: "700", fontSize: 15 },
  secondary: { marginTop: 12, alignItems: "center", padding: 8 },
  secondaryText: { color: theme.colors.textMuted, fontSize: 13 },
});
