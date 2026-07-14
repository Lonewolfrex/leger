import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { theme } from "@/src/theme";

type ToastMsg = { id: number; text: string; type: "info" | "success" | "error" };

let pushRef: ((t: Omit<ToastMsg, "id">) => void) | null = null;

export function showToast(text: string, type: ToastMsg["type"] = "info") {
  if (pushRef) pushRef({ text, type });
}

export function ToastHost() {
  const [msgs, setMsgs] = useState<ToastMsg[]>([]);
  useEffect(() => {
    pushRef = (t) => {
      const id = Date.now() + Math.random();
      setMsgs((m) => [...m, { ...t, id }]);
      setTimeout(() => setMsgs((m) => m.filter((x) => x.id !== id)), 2600);
    };
    return () => {
      pushRef = null;
    };
  }, []);
  return (
    <View pointerEvents="none" style={styles.host}>
      {msgs.map((m) => (
        <ToastItem key={m.id} msg={m} />
      ))}
    </View>
  );
}

function ToastItem({ msg }: { msg: ToastMsg }) {
  const [opacity] = useState(new Animated.Value(0));
  useEffect(() => {
    Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [opacity]);
  const bg =
    msg.type === "success"
      ? theme.colors.brand
      : msg.type === "error"
      ? theme.colors.error
      : theme.colors.surface2;
  const color = msg.type === "success" ? theme.colors.onBrand : theme.colors.text;
  return (
    <Animated.View style={[styles.toast, { backgroundColor: bg, opacity }]} testID={`toast-${msg.type}`}>
      <Text style={[styles.toastText, { color }]}>{msg.text}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    top: 60,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 9999,
  },
  toast: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: theme.radius.md,
    maxWidth: "88%",
  },
  toastText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
