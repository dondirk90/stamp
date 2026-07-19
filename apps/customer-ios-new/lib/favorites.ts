import AsyncStorage from "@react-native-async-storage/async-storage";

import { apiFetch } from "@/lib/api";
import type { CustomerSession } from "@/lib/session";

const storageKey = "customer_saved_cafes_v1";

export async function getFavorites(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(storageKey);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export async function setFavorites(
  list: string[],
  session?: CustomerSession | null,
): Promise<void> {
  await AsyncStorage.setItem(storageKey, JSON.stringify(list));
  if (session) {
    void syncFavoritesToServer(session, list);
  }
}

export async function toggleFavorite(
  cafeAddress: string,
  session?: CustomerSession | null,
): Promise<string[]> {
  const addr = cafeAddress.toLowerCase();
  const current = await getFavorites();
  const next = current.includes(addr)
    ? current.filter((entry) => entry !== addr)
    : [...current, addr];
  await setFavorites(next, session);
  return next;
}

export async function syncFavoritesToServer(
  session: CustomerSession,
  cafes: string[],
): Promise<boolean> {
  if (!session.email || !session.customer_id || !session.address) {
    return false;
  }

  try {
    await apiFetch("/customers/saved-cafes/sync", {
      method: "POST",
      body: JSON.stringify({
        email: session.email,
        customerId: session.customer_id,
        address: session.address,
        cafes,
      }),
    });
    return true;
  } catch {
    return false;
  }
}
