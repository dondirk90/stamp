import React from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { AppTheme, Brand, Type } from "@/constants/theme";
import { apiFetch } from "@/lib/api";
import { getFavorites, toggleFavorite } from "@/lib/favorites";
import type { CustomerSession } from "@/lib/session";

export type PublicCafe = {
  id: number | string;
  name: string | null;
  address: string | null;
  cafeAddress: string | null;
  lat?: number | null;
  lng?: number | null;
  websiteUrl?: string | null;
  instagramUrl?: string | null;
  about?: string | null;
  logoDataUrl?: string | null;
  cardTheme?: string | null;
  cardBackText?: string | null;
  images?: string[];
  program?: {
    stampsForReward?: number;
    rewardDescription?: string | null;
  };
};

type CafeDetailResponse = {
  ok?: boolean;
  cafe?: PublicCafe;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  cafe?: PublicCafe | null;
  cafeId?: number | string | null;
  session?: CustomerSession | null;
};

export function CafeDetailModal({ visible, onClose, cafe, cafeId, session }: Props) {
  const [detail, setDetail] = React.useState<PublicCafe | null>(cafe || null);
  const [loading, setLoading] = React.useState(false);
  const [favorites, setFavorites] = React.useState<string[]>([]);
  const resolvedId = cafeId ?? cafe?.id ?? null;

  React.useEffect(() => {
    setDetail(cafe || null);
  }, [cafe]);

  React.useEffect(() => {
    if (!visible || resolvedId == null) return;

    let active = true;
    setLoading(true);
    apiFetch<CafeDetailResponse>(`/cafes/public/${encodeURIComponent(String(resolvedId))}`)
      .then((data) => {
        if (active && data?.cafe) setDetail(data.cafe);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [visible, resolvedId]);

  React.useEffect(() => {
    if (!visible) return;
    let active = true;
    getFavorites().then((list) => {
      if (active) setFavorites(list);
    });
    return () => {
      active = false;
    };
  }, [visible]);

  const cafeAddress = detail?.cafeAddress || cafe?.cafeAddress || null;
  const isFavorite = !!cafeAddress && favorites.includes(cafeAddress.toLowerCase());

  async function handleToggleFavorite() {
    if (!cafeAddress) return;
    const next = await toggleFavorite(cafeAddress, session);
    setFavorites(next);
  }

  const stamps = Math.max(1, Number(detail?.program?.stampsForReward || 10));
  const reward = String(detail?.program?.rewardDescription || "Freigetränk").trim();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <ScrollView
          style={styles.card}
          contentContainerStyle={styles.cardContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.eyebrow}>Kurzprofil</Text>
          <Text style={styles.title}>{detail?.name || cafe?.name || "Partnercafé"}</Text>

          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Standort</Text>
            <Text style={styles.infoValue}>{detail?.address || cafe?.address || "Adresse folgt"}</Text>
          </View>

          <View style={styles.infoBlock}>
            <Text style={styles.infoLabel}>Stempelkarte</Text>
            <Text style={styles.infoValue}>{`${stamps} Stempel bis ${reward}`}</Text>
          </View>

          {detail?.about ? (
            <View style={styles.infoBlock}>
              <Text style={styles.infoLabel}>Beschreibung</Text>
              <Text style={styles.infoValue}>{detail.about}</Text>
            </View>
          ) : null}

          {loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={AppTheme.accent} />
            </View>
          ) : null}

          {session ? (
            <Pressable style={styles.favoriteButton} onPress={handleToggleFavorite}>
              <Text style={styles.favoriteButtonLabel}>
                {isFavorite ? "Aus meinen Karten entfernen" : "Zu meinen Karten hinzufügen"}
              </Text>
            </Pressable>
          ) : (
            <Text style={styles.hint}>
              Bitte zuerst einloggen, um Cafés zu deinen Karten hinzuzufügen.
            </Text>
          )}

          <Pressable style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonLabel}>Schließen</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(20, 10, 4, 0.34)",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  card: {
    maxHeight: "80%",
    backgroundColor: AppTheme.surface,
    borderRadius: 30,
  },
  cardContent: {
    padding: 24,
    gap: 16,
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
    fontWeight: "800",
    color: AppTheme.text,
  },
  infoBlock: {
    borderRadius: 18,
    backgroundColor: AppTheme.surfaceMuted,
    padding: 16,
    gap: 6,
  },
  infoLabel: {
    fontSize: Type.micro,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: AppTheme.textMuted,
  },
  infoValue: {
    fontSize: Type.body,
    lineHeight: 22,
    color: AppTheme.text,
  },
  loadingRow: {
    alignItems: "center",
    paddingVertical: 4,
  },
  favoriteButton: {
    minHeight: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppTheme.accent,
  },
  favoriteButtonLabel: {
    fontSize: Type.meta,
    fontWeight: "800",
    color: Brand.white,
  },
  hint: {
    fontSize: 13,
    lineHeight: 20,
    color: AppTheme.textMuted,
  },
  closeButton: {
    minHeight: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: AppTheme.border,
    backgroundColor: AppTheme.surfaceMuted,
  },
  closeButtonLabel: {
    fontSize: Type.meta,
    fontWeight: "800",
    color: AppTheme.text,
  },
});
