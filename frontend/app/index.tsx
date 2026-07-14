import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ImageBackground,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";

import { useAuth } from "@/src/context/AuthContext";
import { theme } from "@/src/theme";
import { showToast } from "@/src/components/Toast";

const AUTH_BASE = "https://auth.emergentagent.com/";

export default function Login() {
  const { user, loading, signInWithSessionId } = useAuth();
  const router = useRouter();
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      router.replace("/(tabs)");
    }
  }, [loading, user, router]);

  // Web cold-start: handle session_id in URL hash/query
  useEffect(() => {
    if (Platform.OS !== "web") return;
    if (typeof window === "undefined") return;
    const url = window.location.href;
    const sid = extractSessionId(url);
    if (sid) {
      (async () => {
        try {
          setSigningIn(true);
          await signInWithSessionId(sid);
          window.history.replaceState(null, "", window.location.pathname);
        } catch (e) {
          showToast((e as Error).message || "Sign in failed", "error");
        } finally {
          setSigningIn(false);
        }
      })();
    }
  }, [signInWithSessionId]);

  // Mobile cold-start: handle deep link session_id
  useEffect(() => {
    if (Platform.OS === "web") return;
    let mounted = true;
    (async () => {
      const initial = await Linking.getInitialURL();
      if (initial && mounted) {
        const sid = extractSessionId(initial);
        if (sid) {
          try {
            setSigningIn(true);
            await signInWithSessionId(sid);
          } catch (e) {
            showToast((e as Error).message || "Sign in failed", "error");
          } finally {
            if (mounted) setSigningIn(false);
          }
        }
      }
    })();
    const sub = Linking.addEventListener("url", async ({ url }) => {
      const sid = extractSessionId(url);
      if (sid) {
        try {
          setSigningIn(true);
          await signInWithSessionId(sid);
        } catch (e) {
          showToast((e as Error).message || "Sign in failed", "error");
        } finally {
          setSigningIn(false);
        }
      }
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, [signInWithSessionId]);

  const handleSignIn = async () => {
    setSigningIn(true);
    try {
      const redirectUrl =
        Platform.OS === "web"
          ? window.location.origin + "/"
          : Linking.createURL("");
      const authUrl = `${AUTH_BASE}?redirect=${encodeURIComponent(redirectUrl)}`;
      if (Platform.OS === "web") {
        window.location.href = authUrl;
        return;
      }
      const result = await WebBrowser.openAuthSessionAsync(authUrl, redirectUrl);
      if (result.type === "success" && result.url) {
        const sid = extractSessionId(result.url);
        if (sid) {
          await signInWithSessionId(sid);
        } else {
          showToast("No session returned from auth", "error");
        }
      }
    } catch (e) {
      showToast((e as Error).message || "Sign in failed", "error");
    } finally {
      setSigningIn(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer} testID="login-loading">
        <ActivityIndicator color={theme.colors.brand} size="large" />
      </View>
    );
  }

  return (
    <View style={styles.container} testID="login-screen">
      <ImageBackground
        source={{
          uri: "https://images.unsplash.com/photo-1655841439659-0afc60676b70?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2NzB8MHwxfHNlYXJjaHwyfHxhYnN0cmFjdCUyMGRhcmslMjBvYnNpZGlhbiUyMGVtZXJhbGQlMjBtb2Rlcm4lMjBiYWNrZ3JvdW5kfGVufDB8fHx8MTc4NDA0NTYwN3ww&ixlib=rb-4.1.0&q=85",
        }}
        style={styles.bg}
        resizeMode="cover"
      >
        <LinearGradient
          colors={["transparent", "rgba(12,13,15,0.4)", theme.colors.bg]}
          locations={[0, 0.5, 1]}
          style={styles.scrim}
        />
        <View style={styles.content}>
          <View style={styles.brandRow}>
            <View style={styles.brandDot} />
            <Text style={styles.brandTitle}>ledger.</Text>
          </View>
          <Text style={styles.headline}>Household expenses,{"\n"}shared clearly.</Text>
          <Text style={styles.sub}>
            Track every rupee across all earners in your home. Categorised, receipted, together.
          </Text>

          <TouchableOpacity
            testID="google-signin-button"
            onPress={handleSignIn}
            disabled={signingIn}
            style={[styles.button, signingIn && { opacity: 0.6 }]}
            activeOpacity={0.85}
          >
            {signingIn ? (
              <ActivityIndicator color={theme.colors.onBrand} />
            ) : (
              <>
                <Ionicons name="logo-google" size={20} color={theme.colors.onBrand} />
                <Text style={styles.buttonText}>Continue with Google</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.footer}>
            By continuing, multiple earners in the same household can sign in and update the shared ledger.
          </Text>
        </View>
      </ImageBackground>
    </View>
  );
}

function extractSessionId(url: string): string | null {
  try {
    const hashIdx = url.indexOf("#");
    const queryIdx = url.indexOf("?");
    const parts = [
      hashIdx >= 0 ? url.substring(hashIdx + 1) : "",
      queryIdx >= 0 ? url.substring(queryIdx + 1) : "",
    ];
    for (const p of parts) {
      if (!p) continue;
      const params = new URLSearchParams(p);
      const sid = params.get("session_id");
      if (sid) return sid;
    }
  } catch {}
  return null;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.bg },
  loadingContainer: {
    flex: 1,
    backgroundColor: theme.colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  bg: { flex: 1 },
  scrim: { ...StyleSheet.absoluteFillObject },
  content: {
    flex: 1,
    justifyContent: "flex-end",
    padding: 24,
    paddingBottom: 40,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
  },
  brandDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.brand,
    marginRight: 8,
  },
  brandTitle: {
    color: theme.colors.text,
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.5,
  },
  headline: {
    color: theme.colors.text,
    fontSize: 34,
    fontWeight: "800",
    letterSpacing: -1,
    lineHeight: 40,
    marginBottom: 12,
  },
  sub: {
    color: theme.colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 32,
  },
  button: {
    flexDirection: "row",
    backgroundColor: theme.colors.brand,
    borderRadius: theme.radius.pill,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  buttonText: {
    color: theme.colors.onBrand,
    fontSize: 16,
    fontWeight: "700",
  },
  footer: {
    color: theme.colors.textDim,
    fontSize: 12,
    marginTop: 16,
    lineHeight: 18,
  },
});
