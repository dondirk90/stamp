import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";

import { AppTheme } from "@/constants/theme";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: AppTheme.accent,
        tabBarInactiveTintColor: AppTheme.textMuted,
        tabBarStyle: {
          backgroundColor: AppTheme.surface,
          borderTopColor: AppTheme.border,
          height: 88,
          paddingTop: 8,
          paddingBottom: 22,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "700",
          letterSpacing: 0.6,
        },
        sceneStyle: {
          backgroundColor: AppTheme.background,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Start",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cafe-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: "Cafés",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="compass-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Konto",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
