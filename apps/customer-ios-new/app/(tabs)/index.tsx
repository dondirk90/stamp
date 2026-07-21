import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { CafeDetailModal } from "@/components/CafeDetailModal";
import { AppTheme, Brand, Type } from "@/constants/theme";
import { apiFetch, ApiError } from "@/lib/api";
import { buildRedeemLink, buildStampLink } from "@/lib/qr";
import {
  loadCustomerSession,
  saveCustomerSession,
  type CustomerSession,
} from "@/lib/session";
import {
  buildProgressLabel,
  buildStampDots,
  isCardFull,
  useWalletCards,
  type WalletCard,
} from "@/lib/wallet";

type AuthMode = "register" | "login";
type MessageTone = "success" | "danger" | "neutral";

type RegisterResponse = {
  verificationRequired?: boolean;
};

type LoginResponse = {
  address?: string;
  username?: string | null;
  customer_id?: string | null;
};

const CARD_GAP = 14;
const CARD_SIDE_PADDING = 20;

export default function HomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(width - CARD_SIDE_PADDING * 2, 420);

  const [mode, setMode] = React.useState<AuthMode>("register");
  const [username, setUsername] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [session, setSession] = React.useState<CustomerSession | null>(null);
  const [message, setMessage] = React.useState<{
    tone: MessageTone;
    text: string;
  } | null>(null);
  const [selectedCard, setSelectedCard] = React.useState<WalletCard | null>(null);
  const [detailCard, setDetailCard] = React.useState<WalletCard | null>(null);

  const isRegister = mode === "register";
  const { cards, loading: cardsLoading, refresh, toggleCardFavorite } =
    useWalletCards(session);

  useFocusEffect(
    React.useCallback(() => {
      let active = true;

      loadCustomerSession().then((storedSession) => {
        if (active) setSession(storedSession);
      });
      void refresh();

      return () => {
        active = false;
      };
    }, [refresh]),
  );

  React.useEffect(() => {
    setMessage(null);
  }, [mode]);

  async function handleSubmit() {
    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();

    if (isRegister) {
      if (!cleanUsername || cleanUsername.length < 2) {
        setMessage({
          tone: "danger",
          text: "Bitte gib einen Nutzernamen mit mindestens zwei Zeichen ein.",
        });
        return;
      }
      if (password.length < 6) {
        setMessage({
          tone: "danger",
          text: "Dein Passwort sollte mindestens sechs Zeichen lang sein.",
        });
        return;
      }
      if (password !== confirmPassword) {
        setMessage({
          tone: "danger",
          text: "Die beiden Passwörter stimmen noch nicht überein.",
        });
        return;
      }
    }

    if (!cleanEmail || !cleanEmail.includes("@")) {
      setMessage({
        tone: "danger",
        text: "Bitte gib eine gültige E-Mail-Adresse ein.",
      });
      return;
    }

    if (!password) {
      setMessage({
        tone: "danger",
        text: "Bitte gib dein Passwort ein.",
      });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      if (isRegister) {
        const data = await apiFetch<RegisterResponse>("/customers/register", {
          method: "POST",
          body: JSON.stringify({
            username: cleanUsername,
            email: cleanEmail,
            password,
            acceptPrivacy: true,
            acceptTerms: true,
          }),
        });

        if (!data?.verificationRequired) {
          throw new Error("Ungültige Antwort");
        }

        setPassword("");
        setConfirmPassword("");
        setMode("login");
        setMessage({
          tone: "success",
          text: "Fast geschafft. Bitte bestätige jetzt deine E-Mail-Adresse und logge dich danach ein.",
        });
        return;
      }

      const data = await apiFetch<LoginResponse>("/customers/login", {
        method: "POST",
        body: JSON.stringify({
          email: cleanEmail,
          password,
        }),
      });

      if (!data?.address) {
        throw new Error("Ungültige Antwort");
      }

      const nextSession = {
        address: data.address,
        email: cleanEmail,
        username: data.username || null,
        customer_id: data.customer_id || null,
      };

      await saveCustomerSession(nextSession);
      setSession(nextSession);
      setPassword("");
      setMessage({
        tone: "success",
        text: "Du bist eingeloggt. Deine Wallet ist jetzt der neue Startpunkt.",
      });
    } catch (error) {
      setMessage({
        tone: "danger",
        text: mapAuthError(error, isRegister ? "register" : "login"),
      });
    } finally {
      setLoading(false);
    }
  }

  if (session) {
    return (
      <SafeAreaView style={styles.safe}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.heroCard}>
            <Text style={styles.eyebrow}>Kaffeekarte</Text>
            <Text style={styles.heroTitle}>
              {session.username ? `Hallo, ${session.username}.` : "Deine Kaffeekarte."}
            </Text>
            <Text style={styles.heroLead}>
              {cards.length
                ? "Bereit für den nächsten Kaffee?"
                : "Entdecke dein erstes Lieblingscafé und starte deine Sammlung."}
            </Text>

            <Pressable
              style={styles.primaryButton}
              onPress={() => router.push("/discover")}
            >
              <Text style={styles.primaryButtonLabel}>Cafés entdecken</Text>
            </Pressable>
          </View>

          {message ? (
            <View
              style={[
                styles.messageCard,
                message.tone === "success"
                  ? styles.messageCardSuccess
                  : message.tone === "danger"
                    ? styles.messageCardDanger
                    : null,
              ]}
            >
              <Text
                style={[
                  styles.messageText,
                  message.tone === "success"
                    ? styles.messageTextSuccess
                    : message.tone === "danger"
                      ? styles.messageTextDanger
                      : null,
                ]}
              >
                {message.text}
              </Text>
            </View>
          ) : null}

          <View style={styles.walletHeader}>
            <Text style={styles.walletTitle}>Deine Karten</Text>
            <Text style={styles.walletMeta}>{cards.length}</Text>
          </View>

          {cardsLoading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator color={AppTheme.accent} />
              <Text style={styles.emptyText}>Karten werden geladen…</Text>
            </View>
          ) : cards.length ? (
            <FlatList
              data={cards}
              keyExtractor={(card, index) =>
                card.cafeAddress || card.cafeName || String(index)
              }
              horizontal
              pagingEnabled
              decelerationRate="fast"
              snapToInterval={cardWidth + CARD_GAP}
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: CARD_GAP }}
              style={styles.carousel}
              renderItem={({ item }) => (
                <CardPage
                  card={item}
                  width={cardWidth}
                  onToggleFavorite={() =>
                    item.cafeAddress && toggleCardFavorite(item.cafeAddress)
                  }
                  onPressQr={() => setSelectedCard(item)}
                  onPressDetail={() => setDetailCard(item)}
                />
              )}
            />
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Noch keine Karten</Text>
              <Text style={styles.emptyText}>
                Entdecke Cafés und füge sie zu deinen Karten hinzu, um hier deine
                erste Stempelkarte zu sehen.
              </Text>
              <Pressable
                style={styles.primaryButton}
                onPress={() => router.push("/discover")}
              >
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

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <Text style={styles.eyebrow}>Kaffeekarte Customer</Text>
          <Text style={styles.heroTitle}>
            {isRegister ? "Neu bei Kaffeekarte?" : "Willkommen zurück"}
          </Text>
          <Text style={styles.heroLead}>
            {isRegister
              ? "Registriere dich und behalte Stempel, Rewards und deine Lieblingscafés an einem Ort."
              : "Logge dich ein und mach dort weiter, wo dein nächster Kaffee schon auf dich wartet."}
          </Text>

          <View style={styles.segment}>
            <SegmentButton
              active={isRegister}
              label="Registrieren"
              onPress={() => setMode("register")}
            />
            <SegmentButton
              active={!isRegister}
              label="Login"
              onPress={() => setMode("login")}
            />
          </View>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.formTitle}>
            {isRegister
              ? "Erstelle dein Konto und sammle digital."
              : "Schön, dass du wieder da bist."}
          </Text>

          {isRegister ? (
            <Field
              label="Username"
              placeholder="Wie sollen wir dich nennen?"
              hint="Nur für deinen Account, nicht für die große Bühne gedacht."
              value={username}
              onChangeText={setUsername}
            />
          ) : null}

          <Field
            label="E-Mail"
            placeholder="name@beispiel.de"
            keyboardType="email-address"
            autoCapitalize="none"
            hint="Darüber loggst du dich später wieder ein."
            value={email}
            onChangeText={setEmail}
          />

          <Field
            label="Passwort"
            placeholder={isRegister ? "Sicheres Passwort wählen" : "Passwort eingeben"}
            secureTextEntry
            hint={
              isRegister
                ? "Deine Wallet entsteht im Hintergrund automatisch."
                : "Danach geht es direkt zurück zu deinen Karten."
            }
            value={password}
            onChangeText={setPassword}
          />

          {isRegister ? (
            <Field
              label="Passwort bestätigen"
              placeholder="Passwort wiederholen"
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />
          ) : null}

          {message ? (
            <View
              style={[
                styles.messageCard,
                message.tone === "success"
                  ? styles.messageCardSuccess
                  : message.tone === "danger"
                    ? styles.messageCardDanger
                    : null,
              ]}
            >
              <Text
                style={[
                  styles.messageText,
                  message.tone === "success"
                    ? styles.messageTextSuccess
                    : message.tone === "danger"
                      ? styles.messageTextDanger
                      : null,
                ]}
              >
                {message.text}
              </Text>
            </View>
          ) : null}

          <Pressable
            style={[
              styles.primaryButton,
              loading ? styles.primaryButtonDisabled : null,
            ]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={Brand.white} />
            ) : (
              <Text style={styles.primaryButtonLabel}>
                {isRegister ? "Account erstellen" : "Einloggen"}
              </Text>
            )}
          </Pressable>

          <Text style={styles.helperText}>
            {isRegister
              ? "Registrierung und Login laufen jetzt gegen das echte Backend."
              : "Nach dem Login wird bereits die echte Wallet vom Backend geladen."}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function CardPage({
  card,
  width,
  onToggleFavorite,
  onPressQr,
  onPressDetail,
}: {
  card: WalletCard;
  width: number;
  onToggleFavorite: () => void;
  onPressQr: () => void;
  onPressDetail: () => void;
}) {
  return (
    <View style={[styles.cardPage, { width }]}>
      <Pressable style={styles.cafeRow} onPress={onPressQr}>
        <View style={styles.cafeRowHead}>
          <Text style={styles.cafeName} numberOfLines={1}>
            {card.cafeName || "Partnercafé"}
          </Text>
          <Pressable
            hitSlop={10}
            style={styles.starBtn}
            onPress={(event) => {
              event.stopPropagation();
              onToggleFavorite();
            }}
          >
            <Ionicons
              name={card.isFavorite ? "star" : "star-outline"}
              size={22}
              color={card.isFavorite ? "#c8912a" : AppTheme.textMuted}
            />
          </Pressable>
        </View>

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
            onPressDetail();
          }}
        >
          <Text style={styles.detailLinkLabel}>Café ansehen</Text>
        </Pressable>
      </Pressable>
    </View>
  );
}

function mapAuthError(error: unknown, mode: AuthMode): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "invalid_username":
        return "Bitte wähle einen Nutzernamen mit mindestens zwei Zeichen.";
      case "invalid_email":
        return "Bitte prüfe deine E-Mail-Adresse noch einmal.";
      case "invalid_password":
        return mode === "register"
          ? "Dein Passwort muss mindestens sechs Zeichen lang sein."
          : "Bitte gib dein Passwort ein.";
      case "email_verification_pending":
        return "Deine E-Mail-Adresse ist noch nicht bestätigt. Bitte prüfe dein Postfach.";
      case "email_already_registered":
        return "Für diese E-Mail gibt es bereits ein Konto. Nutze einfach den Login.";
      case "verification_email_failed":
        return "Die Bestätigungs-E-Mail konnte gerade nicht versendet werden. Bitte versuche es gleich noch einmal.";
      case "not_found":
        return "Für diese E-Mail wurde noch kein Konto gefunden.";
      case "password_not_set":
      case "wrong_password":
        return "Die Kombination aus E-Mail und Passwort passt noch nicht.";
      case "email_not_verified":
        return "Bitte bestätige zuerst deine E-Mail-Adresse und logge dich danach ein.";
      default:
        break;
    }
  }

  return mode === "register"
    ? "Registrierung fehlgeschlagen. Bitte versuche es gleich noch einmal."
    : "Anmeldung fehlgeschlagen. Bitte versuche es gleich noch einmal.";
}

function SegmentButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.segmentButton, active ? styles.segmentButtonActive : null]}
    >
      <Text
        style={[
          styles.segmentButtonLabel,
          active ? styles.segmentButtonLabelActive : null,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Field({
  label,
  placeholder,
  hint,
  value,
  onChangeText,
  secureTextEntry,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  placeholder: string;
  hint?: string;
  value: string;
  onChangeText: (value: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "email-address";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholder={placeholder}
        placeholderTextColor={AppTheme.textMuted}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        style={styles.input}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
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
    paddingTop: 10,
    paddingBottom: 28,
    gap: 18,
  },
  heroCard: {
    backgroundColor: AppTheme.surface,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: AppTheme.border,
    padding: 22,
    gap: 12,
  },
  eyebrow: {
    fontSize: Type.micro,
    fontWeight: "800",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    color: AppTheme.textMuted,
  },
  heroTitle: {
    fontSize: Type.title,
    lineHeight: 32,
    fontWeight: "800",
    letterSpacing: -0.8,
    color: AppTheme.text,
  },
  heroLead: {
    fontSize: Type.body,
    lineHeight: 24,
    color: AppTheme.textMuted,
  },
  segment: {
    flexDirection: "row",
    backgroundColor: AppTheme.surfaceMuted,
    borderRadius: 18,
    padding: 4,
    marginTop: 4,
  },
  segmentButton: {
    flex: 1,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },
  segmentButtonActive: {
    backgroundColor: AppTheme.surface,
  },
  segmentButtonLabel: {
    fontSize: Type.meta,
    fontWeight: "700",
    color: AppTheme.textMuted,
  },
  segmentButtonLabelActive: {
    color: AppTheme.text,
  },
  formCard: {
    backgroundColor: AppTheme.surface,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: AppTheme.border,
    padding: 22,
    gap: 14,
  },
  formTitle: {
    fontSize: Type.section,
    fontWeight: "700",
    color: AppTheme.text,
  },
  field: {
    gap: 8,
  },
  label: {
    fontSize: Type.meta,
    fontWeight: "700",
    color: AppTheme.text,
  },
  input: {
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: AppTheme.border,
    backgroundColor: "#fffaf4",
    paddingHorizontal: 16,
    fontSize: Type.body,
    color: AppTheme.text,
  },
  hint: {
    fontSize: 12,
    lineHeight: 18,
    color: AppTheme.textMuted,
  },
  messageCard: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  messageCardSuccess: {
    backgroundColor: "rgba(88, 112, 76, 0.12)",
  },
  messageCardDanger: {
    backgroundColor: "rgba(150, 60, 46, 0.10)",
  },
  messageText: {
    fontSize: 13,
    lineHeight: 20,
    color: AppTheme.text,
  },
  messageTextSuccess: {
    color: AppTheme.success,
  },
  messageTextDanger: {
    color: "#963c2e",
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: 20,
    backgroundColor: AppTheme.accent,
    alignItems: "center",
    justifyContent: "center",
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
  helperText: {
    fontSize: 12,
    lineHeight: 18,
    color: AppTheme.textMuted,
  },
  walletHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 2,
  },
  walletTitle: {
    fontSize: Type.section,
    fontWeight: "700",
    color: AppTheme.text,
  },
  walletMeta: {
    fontSize: Type.meta,
    fontWeight: "700",
    color: AppTheme.textMuted,
  },
  carousel: {
    marginHorizontal: -CARD_SIDE_PADDING,
    paddingHorizontal: CARD_SIDE_PADDING,
  },
  cardPage: {
    paddingVertical: 2,
  },
  cafeRow: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: AppTheme.border,
    backgroundColor: "#fffaf4",
    padding: 18,
    gap: 12,
    minHeight: 168,
  },
  cafeRowHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  cafeName: {
    flex: 1,
    fontSize: 20,
    fontWeight: "800",
    color: AppTheme.text,
  },
  starBtn: {
    padding: 2,
  },
  stampRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
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
    alignSelf: "flex-start",
  },
  detailLinkLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: AppTheme.accentSoft,
    textDecorationLine: "underline",
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
