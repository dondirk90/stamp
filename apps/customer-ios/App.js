import React, { useState, useEffect } from "react";
import {
  SafeAreaView,
  StyleSheet,
  Text,
  Button,
  View,
  TextInput,
} from "react-native";
import { BarCodeScanner } from "expo-barcode-scanner";
import { ethers } from "ethers";

export default function App() {
  const [scanned, setScanned] = useState(null);
  const [privateKey, setPrivateKey] = useState("");
  const [hasPermission, setHasPermission] = useState(null);
  const [scannedOnce, setScannedOnce] = useState(false);

  useEffect(() => {
    (async () => {
      const { status } = await BarCodeScanner.requestPermissionsAsync();
      setHasPermission(status === "granted");
    })();
  }, []);

  const onBarCodeScanned = ({ data }) => {
    if (scannedOnce) return; // avoid multiple triggers
    setScannedOnce(true);
    // Expect payload to be prefixed with STAMP: as in other apps
    const payload =
      typeof data === "string" && data.startsWith("STAMP:")
        ? data.slice(6)
        : data;
    setScanned(payload);
  };

  const signAndSubmit = async () => {
    try {
      const parsed = JSON.parse(scanned);
      const wallet = new ethers.Wallet(privateKey);
      const domain = {
        name: "StampCard",
        version: "1",
        chainId: 31337,
        verifyingContract:
          process.env.STAMPCARD_ADDRESS ||
          "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      };
      const types = {
        StampRequest: [
          { name: "cafeId", type: "bytes16" },
          { name: "nonce", type: "bytes32" },
          { name: "expires", type: "uint256" },
          { name: "customer", type: "address" },
        ],
      };
      const value = {
        cafeId: parsed.cafeId,
        nonce: parsed.nonce,
        expires: BigInt(parsed.expires).toString(),
        customer: wallet.address,
      };

      const signature = await wallet._signTypedData(domain, types, value);

      const res = await fetch("http://127.0.0.1:3000/stamp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": "supersecret-dev-key",
        },
        body: JSON.stringify({ signature, request: parsed }),
      });
      const j = await res.json();
      alert(JSON.stringify(j));
    } catch (err) {
      alert("Failed to sign/submit: " + String(err));
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Customer Scanner</Text>
      <View style={styles.cameraBox}>
        {hasPermission === null ? (
          <Text>Requesting camera permission...</Text>
        ) : hasPermission === false ? (
          <Text>No access to camera</Text>
        ) : (
          <BarCodeScanner
            onBarCodeScanned={onBarCodeScanned}
            style={styles.camera}
          />
        )}
      </View>
      <Text selectable>{scanned || "No QR scanned"}</Text>
      <TextInput
        placeholder="private key"
        value={privateKey}
        onChangeText={setPrivateKey}
        style={styles.input}
      />
      <Button
        title="Sign and Submit"
        onPress={signAndSubmit}
        disabled={!scanned || !privateKey}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  title: { fontSize: 20, fontWeight: "600", marginBottom: 12 },
  cameraBox: { height: 300, marginBottom: 12 },
  camera: { flex: 1 },
  input: { borderWidth: 1, borderColor: "#ccc", padding: 8, marginVertical: 8 },
});
