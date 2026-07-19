import { Ionicons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppTheme, Brand, Type } from "@/constants/theme";
import { apiFetch, ApiError } from "@/lib/api";
import { parseScannedPayload, type ParsedScan } from "@/lib/scanner";
import { clearCafeSession, loadCafeSession, type CafeSession } from "@/lib/session";

type ScanStep = "scanning" | "loading" | "confirm" | "success" | "error";

type StampsResponse = {
  stamps?: number;
};

type CustomerPublicResponse = {
  ok?: boolean;
  customer?: {
    username?: string | null;
  };
};

const STAMP_PRESETS = [1, 2, 3];

export default function ScannerScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [session, setSession] = React.useState<CafeSession | null>(null);
  const [step, setStep] = React.useState<ScanStep>("scanning");
  const [scan, setScan] = React.useState<ParsedScan | null>(null);
  const [customerName, setCustomerName] = React.useState<string>("");
  const [currentStamps, setCurrentStamps] = React.useState<number>(0);
  const [amount, setAmount] = React.useState(1);
  const [errorMessage, setErrorMessage] = React.useState<string>("");
  const [submitting, setSubmitting] = React.useState(false);
  const scanLockRef = React.useRef(false);

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

  function resetToScanning() {
    scanLockRef.current = false;
    setScan(null);
    setErrorMessage("");
    setStep("scanning");
  }

  async function handleBarcodeScanned({ data }: { data: string }) {
    if (scanLockRef.current || !session) return;
    scanLockRef.current = true;

    const parsed = parseScannedPayload(data);
    if (!parsed) {
      setErrorMessage("Dieser QR-Code konnte nicht gelesen werden.");
      setStep("error");
      return;
    }

    const ownAddress = String(session.cafeAddress || "").toLowerCase();
    if (parsed.cafe && ownAddress && parsed.cafe.toLowerCase() !== ownAddress) {
      setErrorMessage("Dieser QR-Code gehört zu einem anderen Café.");
      setStep("error");
      return;
    }

    setScan(parsed);
    setAmount(1);
    setStep("loading");

    try {
      const query = new URLSearchParams({
        fallback: "1",
        cafe: ownAddress,
      });
      if (parsed.cardId) query.set("cardId", parsed.cardId);

      const [stampsData, profileData] = await Promise.all([
        apiFetch<StampsResponse>(`/stamps/${parsed.address}?${query.toString()}`),
        apiFetch<CustomerPublicResponse>(`/customers/${parsed.address}/public`).catch(
          () => null,
        ),
      ]);

      setCurrentStamps(Number(stampsData?.stamps || 0));
      setCustomerName(profileData?.customer?.username || parsed.name || "Unbekannt");
      setStep("confirm");
    } catch {
      setErrorMessage("Die Kundendaten konnten nicht geladen werden.");
      setStep("error");
    }
  }

  async function handleConfirm() {
    if (!scan || !session) return;

    if (scan.action === "redeem" && !scan.redeemToken) {
      setErrorMessage("Dieser Einlöse-QR ist veraltet. Bitte einen neuen QR öffnen.");
      setStep("error");
      return;
    }

    setSubmitting(true);
    try {
      if (scan.action === "redeem") {
        await apiFetch("/redeem-reward", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.token}` },
          body: JSON.stringify({
            customer: scan.address,
            customerName,
            qrCafe: scan.cafe,
            redeemToken: scan.redeemToken,
            cardId: scan.cardId,
          }),
        });
      } else {
        await apiFetch("/stamp-by-cafe", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.token}` },
          body: JSON.stringify({
            customer: scan.address,
            customerName,
            count: amount,
            qrCafe: scan.cafe,
            cardId: scan.cardId,
          }),
        });
      }
      setStep("success");
    } catch (submitError) {
      if (
        submitError instanceof ApiError &&
        (submitError.status === 401 || submitError.status === 403)
      ) {
        await clearCafeSession();
        router.replace("/login");
        return;
      }
      setErrorMessage(mapScanError(submitError));
      setStep("error");
    } finally {
      setSubmitting(false);
    }
  }

  if (!permission) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centerFill}>
          <ActivityIndicator color={AppTheme.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.permissionScreen}>
          <View style={styles.card}>
            <Text style={styles.eyebrow}>Kamera</Text>
            <Text style={styles.title}>Zugriff auf die Kamera erlauben</Text>
            <Text style={styles.lead}>
              Wird zum Scannen der Kunden-QR-Codes benötigt.
            </Text>
            <Pressable style={styles.primaryButton} onPress={requestPermission}>
              <Text style={styles.primaryButtonLabel}>Kamera-Zugriff erlauben</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (step === "scanning") {
    return (
      <View style={styles.cameraFill}>
        <CameraView
          style={StyleSheet.absoluteFillObject}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={handleBarcodeScanned}
        />
        <SafeAreaView style={styles.scanOverlay}>
          <View style={styles.scanHint}>
            <Text style={styles.scanHintText}>QR-Code des Kunden scannen</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.screen}>
        {step === "loading" ? (
          <View style={styles.centerFill}>
            <ActivityIndicator color={AppTheme.accent} />
            <Text style={styles.lead}>Kunde wird geladen…</Text>
          </View>
        ) : null}

        {step === "confirm" && scan ? (
          <View style={styles.card}>
            <Text style={styles.eyebrow}>
              {scan.action === "redeem" ? "Belohnung einlösen" : "Stempel vergeben"}
            </Text>
            <Text style={styles.title}>{customerName}</Text>
            <Text style={styles.lead}>{`Aktueller Stand: ${currentStamps} Stempel`}</Text>

            {scan.action === "stamp" ? (
              <View style={styles.presetRow}>
                {STAMP_PRESETS.map((preset) => (
                  <Pressable
                    key={preset}
                    style={[
                      styles.presetButton,
                      amount === preset ? styles.presetButtonActive : null,
                    ]}
                    onPress={() => setAmount(preset)}
                  >
                    <Text
                      style={[
                        styles.presetButtonLabel,
                        amount === preset ? styles.presetButtonLabelActive : null,
                      ]}
                    >
                      {preset}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <Pressable
              style={[styles.primaryButton, submitting ? styles.primaryButtonDisabled : null]}
              onPress={handleConfirm}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color={Brand.white} />
              ) : (
                <Text style={styles.primaryButtonLabel}>
                  {scan.action === "redeem"
                    ? "Einlösen"
                    : `Stempel vergeben (${amount})`}
                </Text>
              )}
            </Pressable>

            <Pressable style={styles.secondaryButton} onPress={resetToScanning}>
              <Text style={styles.secondaryButtonLabel}>Abbrechen</Text>
            </Pressable>
          </View>
        ) : null}

        {step === "success" ? (
          <View style={styles.card}>
            <Ionicons name="checkmark-circle" size={48} color={AppTheme.success} />
            <Text style={styles.title}>
              {scan?.action === "redeem" ? "Belohnung eingelöst" : "Stempel vergeben"}
            </Text>
            <Pressable style={styles.primaryButton} onPress={resetToScanning}>
              <Text style={styles.primaryButtonLabel}>Weiter scannen</Text>
            </Pressable>
          </View>
        ) : null}

        {step === "error" ? (
          <View style={styles.card}>
            <Text style={styles.eyebrow}>Fehler</Text>
            <Text style={styles.lead}>{errorMessage}</Text>
            <Pressable style={styles.primaryButton} onPress={resetToScanning}>
              <Text style={styles.primaryButtonLabel}>Erneut versuchen</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function mapScanError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "wrong_cafe":
        return "Dieser QR-Code gehört zu einem anderen Café.";
      case "redeem_token_missing":
        return "Dieser Einlöse-QR ist veraltet. Bitte einen neuen QR öffnen.";
      case "redeem_token_invalid":
        return "Ungültiger Einlöse-Code.";
      case "redeem_token_used":
        return "Dieser Einlöse-QR wurde bereits verwendet.";
      case "invalid customer address":
        return "Der gescannte Kunden-Code ist ungültig.";
      default:
        break;
    }
  }
  return "Aktion fehlgeschlagen. Bitte versuche es erneut.";
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
    justifyContent: "center",
  },
  centerFill: {
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  cameraFill: {
    flex: 1,
    backgroundColor: "#000",
  },
  scanOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    alignItems: "center",
    paddingBottom: 40,
  },
  scanHint: {
    backgroundColor: "rgba(20, 10, 4, 0.55)",
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  scanHintText: {
    color: Brand.white,
    fontSize: Type.body,
    fontWeight: "700",
  },
  permissionScreen: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: AppTheme.surface,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: AppTheme.border,
    padding: 24,
    gap: 14,
    alignItems: "center",
  },
  eyebrow: {
    fontSize: Type.micro,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: AppTheme.textMuted,
    alignSelf: "flex-start",
  },
  title: {
    fontSize: Type.title,
    lineHeight: 32,
    fontWeight: "800",
    color: AppTheme.text,
    alignSelf: "flex-start",
  },
  lead: {
    fontSize: Type.body,
    lineHeight: 24,
    color: AppTheme.textMuted,
    alignSelf: "flex-start",
  },
  presetRow: {
    flexDirection: "row",
    gap: 10,
    alignSelf: "stretch",
  },
  presetButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: AppTheme.border,
    backgroundColor: AppTheme.surfaceMuted,
  },
  presetButtonActive: {
    backgroundColor: AppTheme.accent,
    borderColor: AppTheme.accent,
  },
  presetButtonLabel: {
    fontSize: Type.section,
    fontWeight: "800",
    color: AppTheme.text,
  },
  presetButtonLabelActive: {
    color: Brand.white,
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: 20,
    backgroundColor: AppTheme.accent,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
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
  secondaryButton: {
    minHeight: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "stretch",
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
