import { useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppTheme, Brand, Type } from "@/constants/theme";
import { apiFetch, ApiError } from "@/lib/api";
import { saveCafeSession } from "@/lib/session";

type LoginResponse = {
  ok?: boolean;
  token?: string;
  cafe?: {
    id?: number | string;
    name?: string | null;
    cafeAddress?: string | null;
    email?: string | null;
    locationAddress?: string | null;
  };
};

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function handleSubmit() {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      setError("Bitte gib eine gültige E-Mail-Adresse ein.");
      return;
    }
    if (!password) {
      setError("Bitte gib dein Passwort ein.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const data = await apiFetch<LoginResponse>("/cafes/login", {
        method: "POST",
        body: JSON.stringify({ email: cleanEmail, password }),
      });

      if (!data?.token || !data?.cafe) {
        throw new Error("Ungültige Antwort");
      }

      await saveCafeSession({
        token: data.token,
        id: data.cafe.id ?? "",
        name: data.cafe.name ?? null,
        cafeAddress: data.cafe.cafeAddress ?? null,
        email: data.cafe.email ?? cleanEmail,
        locationAddress: data.cafe.locationAddress ?? null,
      });

      setPassword("");
      router.replace("/(tabs)");
    } catch (submitError) {
      setError(mapLoginError(submitError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <Text style={styles.eyebrow}>Kaffeekarte Café</Text>
          <Text style={styles.heroTitle}>Willkommen zurück</Text>
          <Text style={styles.heroLead}>
            Logge dich mit deinem Café-Konto ein, um Stempel zu vergeben und
            Belohnungen einzulösen.
          </Text>
        </View>

        <View style={styles.formCard}>
          <View style={styles.field}>
            <Text style={styles.label}>E-Mail</Text>
            <TextInput
              placeholder="cafe@beispiel.de"
              placeholderTextColor={AppTheme.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              value={email}
              onChangeText={setEmail}
              style={styles.input}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Passwort</Text>
            <TextInput
              placeholder="Passwort eingeben"
              placeholderTextColor={AppTheme.textMuted}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              style={styles.input}
            />
          </View>

          {error ? (
            <View style={styles.messageCard}>
              <Text style={styles.messageText}>{error}</Text>
            </View>
          ) : null}

          <Pressable
            style={[styles.primaryButton, loading ? styles.primaryButtonDisabled : null]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={Brand.white} />
            ) : (
              <Text style={styles.primaryButtonLabel}>Einloggen</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function mapLoginError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "missing_fields":
        return "Bitte fülle E-Mail und Passwort aus.";
      case "invalid_credentials":
        return "Die Kombination aus E-Mail und Passwort passt noch nicht.";
      case "email_not_verified":
        return "Bitte bestätige zuerst deine E-Mail-Adresse.";
      default:
        break;
    }
  }
  return "Anmeldung fehlgeschlagen. Bitte versuche es gleich noch einmal.";
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: AppTheme.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 28,
    gap: 18,
  },
  heroCard: {
    backgroundColor: AppTheme.surface,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: AppTheme.border,
    padding: 22,
    gap: 12,
  },
  eyebrow: {
    fontSize: Type.micro,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: AppTheme.textMuted,
  },
  heroTitle: {
    fontSize: Type.title,
    lineHeight: 32,
    fontWeight: "800",
    letterSpacing: -0.8,
    color: AppTheme.text,
  },
  heroLead: {
    fontSize: Type.body,
    lineHeight: 24,
    color: AppTheme.textMuted,
  },
  formCard: {
    backgroundColor: AppTheme.surface,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: AppTheme.border,
    padding: 22,
    gap: 14,
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: Type.meta,
    fontWeight: "700",
    color: AppTheme.text,
  },
  input: {
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: AppTheme.border,
    backgroundColor: "#fffaf4",
    paddingHorizontal: 16,
    fontSize: Type.body,
    color: AppTheme.text,
  },
  messageCard: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(150, 60, 46, 0.10)",
  },
  messageText: {
    fontSize: 13,
    lineHeight: 20,
    color: "#963c2e",
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: 20,
    backgroundColor: AppTheme.accent,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  primaryButtonLabel: {
    fontSize: Type.body,
    fontWeight: "800",
    color: Brand.white,
  },
});
