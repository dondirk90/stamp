import { Image } from "expo-image";
import React from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { apiFetch, ApiError } from "@/lib/api";
import { AppTheme, Brand, Type } from "@/constants/theme";

type PublicCafe = {
  id: number;
  name: string | null;
  address: string | null;
  cafeAddress: string | null;
  lat: number | null;
  lng: number | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  about: string | null;
  logoDataUrl: string | null;
  cardTheme?: string | null;
  cardBackText?: string | null;
  program?: {
    stampsForReward?: number;
    rewardDescription?: string | null;
  };
};

type PublicCafeResponse = {
  ok?: boolean;
  cafes?: PublicCafe[];
};

export default function DiscoverScreen() {
  const [cafes, setCafes] = React.useState<PublicCafe[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedCafe, setSelectedCafe] = React.useState<PublicCafe | null>(null);

  React.useEffect(() => {
    void loadCafes();
  }, []);

  async function loadCafes(refresh = false) {
    if (refresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);

    try {
      const data = await apiFetch<PublicCafeResponse>("/cafes/public");
      setCafes(Array.isArray(data?.cafes) ? data.cafes : []);
    } catch (nextError) {
      setError(mapDiscoverError(nextError));
    } finally {
      if (refresh) {
        setRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadCafes(true)}
            tintColor={AppTheme.accent}
          />
        }
      >
        <View style={styles.heroCard}>
          <Text style={styles.eyebrow}>Discover</Text>
          <Text style={styles.title}>Lieblingscafes entdecken</Text>
          <Text style={styles.lead}>
            Diese Liste kommt jetzt direkt aus dem Backend. Ein Tap auf ein Cafe
            oeffnet das native Kurzprofil.
          </Text>
        </View>

        {error ? (
          <View style={styles.messageCard}>
            <Text style={styles.messageText}>{error}</Text>
          </View>
        ) : null}

        <View style={styles.listCard}>
          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>Partnercafes</Text>
            <Text style={styles.listMeta}>{cafes.length} Eintraege</Text>
          </View>

          {loading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color={AppTheme.accent} />
              <Text style={styles.emptyText}>Cafes werden geladen...</Text>
            </View>
          ) : cafes.length ? (
            <View style={styles.list}>
              {cafes.map((cafe) => (
                <Pressable
                  key={String(cafe.id)}
                  style={styles.row}
                  onPress={() => setSelectedCafe(cafe)}
                >
                  {cafe.logoDataUrl ? (
                    <Image
                      source={{ uri: cafe.logoDataUrl }}
                      style={styles.logo}
                      contentFit="cover"
                    />
                  ) : (
                    <View style={styles.logoFallback}>
                      <Text style={styles.logoFallbackText}>
                        {buildInitials(cafe.name)}
                      </Text>
                    </View>
                  )}

                  <View style={styles.textWrap}>
                    <Text style={styles.name}>{cafe.name || "Partnercafe"}</Text>
                    <Text style={styles.meta} numberOfLines={2}>
                      {cafe.address || "Adresse folgt"}
                    </Text>
                    <Text style={styles.program}>
                      {buildProgramLabel(cafe)}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Noch keine Cafes sichtbar</Text>
              <Text style={styles.emptyText}>
                Sobald Cafes im Backend freigeschaltet sind, erscheinen sie hier.
              </Text>
            </View>
          )}
        </View>
      </ScrollView>

      <Modal
        visible={!!selectedCafe}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedCafe(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.eyebrow}>Kurzprofil</Text>
            <Text style={styles.modalTitle}>
              {selectedCafe?.name || "Partnercafe"}
            </Text>

            <View style={styles.modalInfoBlock}>
              <Text style={styles.modalInfoLabel}>Standort</Text>
              <Text style={styles.modalInfoValue}>
                {selectedCafe?.address || "Adresse folgt"}
              </Text>
            </View>

            <View style={styles.modalInfoBlock}>
              <Text style={styles.modalInfoLabel}>Stempelkarte</Text>
              <Text style={styles.modalInfoValue}>
                {buildProgramLabel(selectedCafe)}
              </Text>
            </View>

            {selectedCafe?.about ? (
              <View style={styles.modalInfoBlock}>
                <Text style={styles.modalInfoLabel}>Beschreibung</Text>
                <Text style={styles.modalInfoValue}>{selectedCafe.about}</Text>
              </View>
            ) : null}

            <View style={styles.modalActions}>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => setSelectedCafe(null)}
              >
                <Text style={styles.secondaryButtonLabel}>Schliessen</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function buildInitials(name?: string | null) {
  const safe = String(name || "Cafe").trim();
  const parts = safe.split(/\s+/).filter(Boolean);
  if (!parts.length) return "C";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function buildProgramLabel(cafe?: PublicCafe | null) {
  const stamps = Math.max(1, Number(cafe?.program?.stampsForReward || 10));
  const reward = String(cafe?.program?.rewardDescription || "Freigetraenk").trim();
  return `${stamps} Stempel bis ${reward}`;
}

function mapDiscoverError(error: unknown) {
  if (error instanceof ApiError) {
    return `Die Cafes konnten nicht geladen werden (${error.code}).`;
  }
  return "Die Cafes konnten gerade nicht geladen werden.";
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
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 28,
    gap: 18,
  },
  heroCard: {
    backgroundColor: AppTheme.surface,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: AppTheme.border,
    padding: 22,
    gap: 10,
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
  listCard: {
    backgroundColor: AppTheme.surface,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: AppTheme.border,
    padding: 22,
    gap: 16,
  },
  listHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  listTitle: {
    fontSize: Type.section,
    fontWeight: "700",
    color: AppTheme.text,
  },
  listMeta: {
    fontSize: Type.meta,
    fontWeight: "700",
    color: AppTheme.textMuted,
  },
  list: {
    gap: 14,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: AppTheme.border,
    backgroundColor: "#fffaf4",
    padding: 16,
  },
  logo: {
    width: 62,
    height: 62,
    borderRadius: 18,
    backgroundColor: AppTheme.surfaceMuted,
  },
  logoFallback: {
    width: 62,
    height: 62,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppTheme.surfaceMuted,
    borderWidth: 1,
    borderColor: AppTheme.border,
  },
  logoFallbackText: {
    fontSize: 18,
    fontWeight: "800",
    color: AppTheme.text,
  },
  textWrap: {
    flex: 1,
    gap: 5,
  },
  name: {
    fontSize: 18,
    fontWeight: "800",
    color: AppTheme.text,
  },
  meta: {
    fontSize: Type.meta,
    lineHeight: 18,
    color: AppTheme.textMuted,
  },
  program: {
    fontSize: 12,
    lineHeight: 18,
    color: AppTheme.accentSoft,
    fontWeight: "700",
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 24,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: AppTheme.text,
  },
  emptyText: {
    fontSize: Type.body,
    lineHeight: 22,
    color: AppTheme.textMuted,
    textAlign: "center",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(20, 10, 4, 0.34)",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  modalCard: {
    backgroundColor: AppTheme.surface,
    borderRadius: 30,
    padding: 24,
    gap: 16,
  },
  modalTitle: {
    fontSize: Type.title,
    fontWeight: "800",
    color: AppTheme.text,
  },
  modalInfoBlock: {
    borderRadius: 18,
    backgroundColor: AppTheme.surfaceMuted,
    padding: 16,
    gap: 6,
  },
  modalInfoLabel: {
    fontSize: Type.micro,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: AppTheme.textMuted,
  },
  modalInfoValue: {
    fontSize: Type.body,
    lineHeight: 22,
    color: AppTheme.text,
  },
  modalActions: {
    marginTop: 4,
  },
  secondaryButton: {
    minHeight: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppTheme.accent,
  },
  secondaryButtonLabel: {
    fontSize: Type.meta,
    fontWeight: "800",
    color: Brand.white,
  },
});
