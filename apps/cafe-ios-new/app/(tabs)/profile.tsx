import React from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppTheme, Type } from "@/constants/theme";
import { apiFetch } from "@/lib/api";
import { clearCafeSession, loadCafeSession, type CafeSession } from "@/lib/session";

export default function ProfileScreen() {
  const router = useRouter();
  const [session, setSession] = React.useState<CafeSession | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      let active = true;
      loadCafeSession().then((stored) => {
        if (active) setSession(stored);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  async function handleLogout() {
    if (session?.token) {
      try {
        await apiFetch("/cafes/logout", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.token}` },
        });
      } catch {
        // Best-effort: session is cleared locally regardless.
      }
    }
    await clearCafeSession();
    router.replace("/login");
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.screen}>
        <Text style={styles.eyebrow}>Profil</Text>
        <Text style={styles.title}>{session?.name || "Dein Café"}</Text>

        <View style={styles.panel}>
          <Text style={styles.item}>E-Mail: {session?.email || "Unbekannt"}</Text>
          <Text style={styles.item}>Adresse: {session?.locationAddress || "Nicht gesetzt"}</Text>
          <Text style={styles.item}>Café-Adresse: {session?.cafeAddress || "Unbekannt"}</Text>
        </View>

        <Pressable style={styles.secondaryButton} onPress={handleLogout}>
          <Text style={styles.secondaryButtonLabel}>Logout</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: AppTheme.background,
  },
  screen: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 14,
    gap: 14,
  },
  eyebrow: {
    fontSize: Type.micro,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: AppTheme.textMuted,
  },
  title: {
    fontSize: Type.title,
    lineHeight: 32,
    fontWeight: "800",
    color: AppTheme.text,
  },
  panel: {
    marginTop: 10,
    backgroundColor: AppTheme.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: AppTheme.border,
    padding: 18,
    gap: 8,
  },
  item: {
    fontSize: Type.body,
    lineHeight: 22,
    color: AppTheme.text,
  },
  secondaryButton: {
    marginTop: 8,
    minHeight: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: AppTheme.border,
    backgroundColor: AppTheme.surfaceMuted,
  },
  secondaryButtonLabel: {
    fontSize: Type.meta,
    fontWeight: "800",
    color: AppTheme.text,
  },
});
