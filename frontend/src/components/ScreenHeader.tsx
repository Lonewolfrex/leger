import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { theme } from "@/src/theme";

export default function ScreenHeader({
  title,
  right,
  testID,
}: {
  title: string;
  right?: React.ReactNode;
  testID?: string;
}) {
  const router = useRouter();
  return (
    <View style={styles.wrap} testID={testID}>
      <TouchableOpacity
        onPress={() => router.back()}
        style={styles.iconBtn}
        testID="header-back-button"
        activeOpacity={0.7}
      >
        <Ionicons name="chevron-back" size={22} color={theme.colors.text} />
      </TouchableOpacity>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      <View style={{ minWidth: 40, alignItems: "flex-end" }}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  iconBtn: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
  },
  title: { flex: 1, color: theme.colors.text, fontSize: 17, fontWeight: "700" },
});
