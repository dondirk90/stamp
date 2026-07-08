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
  const uri = buildWebUri("/customer-wallet");
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
    <View style={styles.root}>
      <WebView
        source={{ uri }}
        originWhitelist={["*"]}
        javaScriptEnabled
        domStorageEnabled
        allowsBackForwardNavigationGestures
        setSupportMultipleWindows={false}
        bounces={false}
        overScrollMode="never"
        opaque
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        containerStyle={styles.webviewContainer}
        style={styles.webview}
        onError={(e) => setError(e.nativeEvent?.description || "WebView error")}
        onHttpError={(e) => setError(`HTTP ${e.nativeEvent?.statusCode || ""}`)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  webviewContainer: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  webview: {
    flex: 1,
    backgroundColor: "#ffffff",
  },
  fallback: {
    flex: 1,
    padding: 18,
    gap: 10,
    justifyContent: "center",
    backgroundColor: "#ffffff",
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
