import { Stack, useRouter, useSegments } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import "react-native-reanimated";

import { AppTheme } from "@/constants/theme";
import { loadCafeSession } from "@/lib/session";

export const unstable_settings = {
  initialRouteName: "login",
};

export default function RootLayout() {
  const [checked, setChecked] = React.useState(false);
  const segments = useSegments();
  const router = useRouter();

  React.useEffect(() => {
    let active = true;

    loadCafeSession().then((session) => {
      if (!active) return;
      setChecked(true);

      const inTabs = segments[0] === "(tabs)";
      if (!session && inTabs) {
        router.replace("/login");
      } else if (session && !inTabs) {
        router.replace("/(tabs)");
      }
    });

    return () => {
      active = false;
    };
  }, [segments, router]);

  if (!checked) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator color={AppTheme.accent} />
      </View>
    );
  }

  return (
    <>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: AppTheme.background },
        }}
      >
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
      </Stack>
      <StatusBar style="dark" backgroundColor={AppTheme.background} />
    </>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppTheme.background,
  },
});
