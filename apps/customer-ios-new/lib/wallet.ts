import React from "react";

import { apiFetch, ApiError } from "@/lib/api";
import type { CustomerSession } from "@/lib/session";

export type WalletCard = {
  cafeAddress: string | null;
  cafeName: string | null;
  cafeId: string | null;
  isFavorite?: boolean;
  program?: {
    stampsForReward?: number;
    rewardDescription?: string;
  };
  stats?: {
    netStamps?: number;
    totalEvents?: number;
    lastActivityTs?: number | null;
  };
};

type WalletResponse = {
  cards?: WalletCard[];
};

function cardRemaining(card: WalletCard) {
  const total = Math.max(1, Number(card?.program?.stampsForReward || 10));
  const collected = Math.max(0, Number(card?.stats?.netStamps || 0));
  return Math.max(total - collected, 0);
}

function sortCards(cards: WalletCard[]) {
  return [...cards].sort((a, b) => {
    const aFav = !!a.isFavorite;
    const bFav = !!b.isFavorite;
    if (aFav !== bFav) return aFav ? -1 : 1;

    const aRemaining = cardRemaining(a);
    const bRemaining = cardRemaining(b);
    if (aRemaining !== bRemaining) return aRemaining - bRemaining;

    const aTs = Number(a?.stats?.lastActivityTs || 0);
    const bTs = Number(b?.stats?.lastActivityTs || 0);
    return bTs - aTs;
  });
}

function sameCafe(card: WalletCard, cafeAddress: string) {
  return (card.cafeAddress || "").toLowerCase() === cafeAddress;
}

export function useWalletCards(session: CustomerSession | null) {
  const [cards, setCards] = React.useState<WalletCard[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async (active = true) => {
    if (!session?.address) {
      if (active) setCards([]);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<WalletResponse>(
        `/customers/${encodeURIComponent(session.address)}/cards`,
      );
      if (active) {
        setCards(sortCards(Array.isArray(data?.cards) ? data.cards : []));
      }
    } catch (nextError) {
      if (active) {
        setError(
          nextError instanceof ApiError && nextError.code === "invalid_customer_address"
            ? "Die Wallet-Adresse ist noch nicht gültig."
            : "Die Wallet-Daten konnten gerade nicht geladen werden.",
        );
      }
    } finally {
      if (active) setLoading(false);
    }
  }, [session?.address]);

  React.useEffect(() => {
    let active = true;
    void refresh(active);
    return () => {
      active = false;
    };
  }, [refresh]);

  const toggleCardFavorite = React.useCallback(
    async (cafeAddress: string) => {
      const addr = cafeAddress.toLowerCase();
      if (!session?.email || !session?.customer_id || !session?.address) return;

      let nextFavorite = false;
      setCards((prev) =>
        sortCards(
          prev.map((card) => {
            if (!sameCafe(card, addr)) return card;
            nextFavorite = !card.isFavorite;
            return { ...card, isFavorite: nextFavorite };
          }),
        ),
      );

      try {
        await apiFetch("/customers/saved-cafes/favorite", {
          method: "POST",
          body: JSON.stringify({
            email: session.email,
            customerId: session.customer_id,
            address: session.address,
            cafeAddress: addr,
            favorite: nextFavorite,
          }),
        });
      } catch {
        setCards((prev) =>
          sortCards(
            prev.map((card) =>
              sameCafe(card, addr) ? { ...card, isFavorite: !nextFavorite } : card,
            ),
          ),
        );
      }
    },
    [session],
  );

  return { cards, loading, error, refresh, toggleCardFavorite };
}

export function buildProgressLabel(card?: WalletCard | null) {
  const collected = Math.max(0, Number(card?.stats?.netStamps || 0));
  const total = Math.max(1, Number(card?.program?.stampsForReward || 10));
  const remaining = Math.max(total - collected, 0);

  if (collected >= total) {
    return "Dein Gratiskaffee wartet.";
  }
  if (remaining === 1) {
    return `Nur noch ${remaining} Kaffee bis zur Gratisrunde.`;
  }
  return `${collected} von ${total} Stempeln · Noch ${remaining} bis zur Belohnung`;
}

export function buildStampDots(card?: WalletCard | null) {
  const total = Math.max(1, Number(card?.program?.stampsForReward || 10));
  const collected = Math.max(0, Number(card?.stats?.netStamps || 0));
  return Array.from({ length: total }, (_, index) => index < collected);
}

export function isCardFull(card?: WalletCard | null) {
  const total = Math.max(1, Number(card?.program?.stampsForReward || 10));
  const collected = Math.max(0, Number(card?.stats?.netStamps || 0));
  return collected >= total;
}
