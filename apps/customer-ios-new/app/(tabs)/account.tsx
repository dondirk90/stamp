import React from "react";
import { useFocusEffect } from "@react-navigation/native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppTheme, Type } from "@/constants/theme";
import {
  clearCustomerSession,
  loadCustomerSession,
  type CustomerSession,
} from "@/lib/session";

export default function AccountScreen() {
  const [session, setSession] = React.useState<CustomerSession | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      let active = true;

      loadCustomerSession().then((nextSession) => {
        if (active) setSession(nextSession);
      });

      return () => {
        active = false;
      };
    }, []),
  );

  async function handleLogout() {
    await clearCustomerSession();
    setSession(null);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.screen}>
        <Text style={styles.eyebrow}>Konto</Text>
        <Text style={styles.title}>
          {session ? "Du bist angemeldet." : "Registrierung zuerst, Login als Option."}
        </Text>
        <Text style={styles.lead}>
          {session
            ? "Hier hängt jetzt bereits eine echte Customer-Session drin. Als Nächstes verbinden wir diesen Zustand mit Wallet, History und QR."
            : "Dieser Screen hält die Produktentscheidung fest: Erstnutzer werden registriert, Rückkehrer loggen sich ein."}
        </Text>

        <View style={styles.panel}>
          <Text style={styles.panelTitle}>
            {session ? "Aktuelle Session" : "Phase 1 Fokus"}
          </Text>
          {session ? (
            <>
              <Text style={styles.item}>Username: {session.username || "Nicht gesetzt"}</Text>
              <Text style={styles.item}>E-Mail: {session.email}</Text>
              <Text style={styles.item}>Customer ID: {session.customer_id || "Unbekannt"}</Text>
              <Text style={styles.item}>Adresse: {session.address}</Text>
              <Pressable style={styles.secondaryButton} onPress={handleLogout}>
                <Text style={styles.secondaryButtonLabel}>Logout</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.item}>• Auth-Struktur nativ modellieren</Text>
              <Text style={styles.item}>• Session im App-Lauf speichern</Text>
              <Text style={styles.item}>• Konto-Screen bewusst einfach halten</Text>
            </>
          )}
        </View>
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
  lead: {
    fontSize: Type.body,
    lineHeight: 24,
    color: AppTheme.textMuted,
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
  panelTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: AppTheme.text,
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
