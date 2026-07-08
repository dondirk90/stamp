import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { WebView } from "react-native-webview";

const DEFAULT_BASE_URL = "http://localhost:8080";

function buildWebUri(path: string) {
  const base = (
    process.env.EXPO_PUBLIC_WEB_BASE_URL || DEFAULT_BASE_URL
  ).replace(/\/+$/, "");
  return `${base}${path}`;
}

export default function HomeScreen() {
  // Cafés will typically land on onboarding/login first.
  const uri = buildWebUri("/cafe-scanner");
  const [error, setError] = React.useState<string>("");

  if (error) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.title}>Konnte die Web-App nicht laden</Text>
        <Text style={styles.muted}>{uri}</Text>
        <Text style={styles.muted}>
          Tipp: Setze in deiner Shell `EXPO_PUBLIC_WEB_BASE_URL` auf deine
          LAN-URL (z.B. `http://192.168.1.100:8080`).
        </Text>
        <Text style={styles.muted}>{error}</Text>
      </View>
    );
  }

  return (
    <WebView
      source={{ uri }}
      originWhitelist={["*"]}
      javaScriptEnabled
      domStorageEnabled
      allowsBackForwardNavigationGestures
      setSupportMultipleWindows={false}
      onError={(e) => setError(e.nativeEvent?.description || "WebView error")}
      onHttpError={(e) => setError(`HTTP ${e.nativeEvent?.statusCode || ""}`)}
    />
  );
}

const styles = StyleSheet.create({
  fallback: {
    flex: 1,
    padding: 18,
    gap: 10,
    justifyContent: "center",
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
  },
  muted: {
    fontSize: 12,
    opacity: 0.7,
  },
});
