import React from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CafeDetailModal } from "@/components/CafeDetailModal";
import { AppTheme, Brand, Type } from "@/constants/theme";
import { buildRedeemLink, buildStampLink } from "@/lib/qr";
import { loadCustomerSession, type CustomerSession } from "@/lib/session";
import {
  buildProgressLabel,
  buildStampDots,
  isCardFull,
  useWalletCards,
  type WalletCard,
} from "@/lib/wallet";

export default function CardsScreen() {
  const router = useRouter();
  const [session, setSession] = React.useState<CustomerSession | null>(null);
  const [sessionChecked, setSessionChecked] = React.useState(false);
  const [selectedCard, setSelectedCard] = React.useState<WalletCard | null>(null);
  const [detailCard, setDetailCard] = React.useState<WalletCard | null>(null);

  const { cards, loading, refresh } = useWalletCards(session);

  useFocusEffect(
    React.useCallback(() => {
      let active = true;

      loadCustomerSession().then((storedSession) => {
        if (!active) return;
        setSession(storedSession);
        setSessionChecked(true);
      });

      void refresh();

      return () => {
        active = false;
      };
    }, [refresh]),
  );

  if (sessionChecked && !session) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.screen}>
          <Text style={styles.eyebrow}>Meine Karten</Text>
          <Text style={styles.title}>Noch nicht eingeloggt.</Text>
          <Text style={styles.lead}>
            Melde dich an, um deine Kaffeekarten und QR-Codes zu sehen.
          </Text>
          <Pressable style={styles.primaryButton} onPress={() => router.push("/")}>
            <Text style={styles.primaryButtonLabel}>Zum Login</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <Text style={styles.eyebrow}>Meine Karten</Text>
          <Text style={styles.title}>Deine Lieblingscafés</Text>
          <Text style={styles.lead}>
            Tippe auf eine Karte für den QR-Code. "Café ansehen" öffnet das Kurzprofil.
          </Text>
        </View>

        {loading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color={AppTheme.accent} />
            <Text style={styles.emptyText}>Karten werden geladen…</Text>
          </View>
        ) : cards.length ? (
          <View style={styles.list}>
            {cards.map((card) => (
              <Pressable
                key={`${card.cafeAddress || card.cafeName}`}
                style={styles.cafeRow}
                onPress={() => setSelectedCard(card)}
              >
                <View style={styles.cafeTextWrap}>
                  <Text style={styles.cafeName}>{card.cafeName || "Partnercafé"}</Text>
                  <Text style={styles.cafeMeta}>{buildProgressLabel(card)}</Text>
                  <View style={styles.stampRow}>
                    {buildStampDots(card).map((filled, index) => (
                      <View
                        key={`${card.cafeAddress || "cafe"}-${index}`}
                        style={[styles.stampDot, filled ? styles.stampDotFilled : null]}
                      />
                    ))}
                  </View>
                  <Pressable
                    style={styles.detailLink}
                    onPress={(event) => {
                      event.stopPropagation();
                      setDetailCard(card);
                    }}
                  >
                    <Text style={styles.detailLinkLabel}>Café ansehen</Text>
                  </Pressable>
                </View>

                <View style={styles.qrBadge}>
                  <Text style={styles.qrBadgeText}>QR</Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Noch keine Karten</Text>
            <Text style={styles.emptyText}>
              Entdecke Cafés und füge sie zu deinen Karten hinzu, um hier deine erste
              Stempelkarte zu sehen.
            </Text>
            <Pressable style={styles.primaryButton} onPress={() => router.push("/discover")}>
              <Text style={styles.primaryButtonLabel}>Cafés entdecken</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      <Modal
        visible={!!selectedCard}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedCard(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.eyebrow}>
              {selectedCard && isCardFull(selectedCard) ? "Gratiskaffee wartet" : "QR bereit"}
            </Text>
            <Text style={styles.modalTitle}>{selectedCard?.cafeName || "Partnercafé"}</Text>
            <Text style={styles.modalLead}>{buildProgressLabel(selectedCard)}</Text>

            {session && selectedCard?.cafeAddress ? (
              <View style={styles.qrWrap}>
                <QRCode
                  value={
                    isCardFull(selectedCard)
                      ? buildRedeemLink(session, selectedCard.cafeAddress)
                      : buildStampLink(session, selectedCard.cafeAddress)
                  }
                  size={220}
                  backgroundColor={Brand.white}
                  color={AppTheme.text}
                />
              </View>
            ) : null}

            <Pressable style={styles.primaryButton} onPress={() => setSelectedCard(null)}>
              <Text style={styles.primaryButtonLabel}>Zurück zur Wallet</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <CafeDetailModal
        visible={!!detailCard}
        onClose={() => setDetailCard(null)}
        cafeId={detailCard?.cafeId}
        session={session}
      />
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
  list: {
    gap: 14,
  },
  cafeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: AppTheme.border,
    backgroundColor: "#fffaf4",
    padding: 16,
  },
  cafeTextWrap: {
    flex: 1,
    gap: 6,
  },
  cafeName: {
    fontSize: 20,
    fontWeight: "800",
    color: AppTheme.text,
  },
  cafeMeta: {
    fontSize: Type.meta,
    lineHeight: 18,
    color: AppTheme.textMuted,
  },
  stampRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
  },
  stampDot: {
    width: 16,
    height: 16,
    borderRadius: 999,
    backgroundColor: "rgba(74, 49, 36, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(74, 49, 36, 0.18)",
  },
  stampDotFilled: {
    backgroundColor: AppTheme.accent,
    borderColor: AppTheme.accent,
  },
  detailLink: {
    marginTop: 6,
    alignSelf: "flex-start",
  },
  detailLinkLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: AppTheme.accentSoft,
    textDecorationLine: "underline",
  },
  qrBadge: {
    width: 56,
    height: 56,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppTheme.surface,
    borderWidth: 1,
    borderColor: AppTheme.border,
  },
  qrBadgeText: {
    fontSize: Type.meta,
    fontWeight: "800",
    color: AppTheme.text,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
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
  primaryButton: {
    minHeight: 54,
    borderRadius: 20,
    backgroundColor: AppTheme.accent,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  primaryButtonLabel: {
    fontSize: Type.body,
    fontWeight: "800",
    color: Brand.white,
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
  modalLead: {
    fontSize: Type.body,
    lineHeight: 22,
    color: AppTheme.textMuted,
  },
  qrWrap: {
    borderRadius: 26,
    borderWidth: 1,
    borderColor: AppTheme.border,
    backgroundColor: "#fffaf4",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 24,
  },
});
