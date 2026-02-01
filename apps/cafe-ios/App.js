import React, { useState } from "react";
import {
  SafeAreaView,
  StyleSheet,
  TextInput,
  Button,
  Text,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";

export default function App() {
  const [token, setToken] = useState("");
  const [ttl, setTtl] = useState("300");
  const [qrPayload, setQrPayload] = useState(null);

  const issueQr = async () => {
    try {
      const bearer = String(token || "").trim();
      if (!bearer) {
        alert("Please paste your session token (Bearer token) first.");
        return;
      }
      const res = await fetch("http://127.0.0.1:3000/qr/issue", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({ ttl: Number(ttl) }),
      });
      const data = await res.json();
      if (data && data.payload) setQrPayload(data.payload);
    } catch (err) {
      alert("Failed to issue QR: " + String(err));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Cafe QR Issuer</Text>
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={token}
          onChangeText={setToken}
          placeholder="Bearer token"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          style={styles.input}
          value={ttl}
          onChangeText={setTtl}
          keyboardType="numeric"
        />
      </View>
      <Button title="Issue QR" onPress={issueQr} />
      {qrPayload ? (
        <View style={styles.qrBox}>
          <Text selectable>{qrPayload}</Text>
          <QRCode value={qrPayload} size={256} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 20, fontWeight: "600", marginBottom: 12 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#ccc",
    padding: 8,
    marginRight: 8,
  },
  row: { flexDirection: "row", marginBottom: 12 },
  qrBox: { alignItems: "center", marginTop: 16 },
});
