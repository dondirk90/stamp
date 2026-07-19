import React from "react";

import { apiFetch, ApiError } from "@/lib/api";
import type { CustomerSession } from "@/lib/session";

export type WalletCard = {
  cafeAddress: string | null;
  cafeName: string | null;
  cafeId: string | null;
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
        setCards(Array.isArray(data?.cards) ? data.cards : []);
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

  return { cards, loading, error, refresh };
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
