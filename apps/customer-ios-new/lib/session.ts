import AsyncStorage from "@react-native-async-storage/async-storage";

export type CustomerSession = {
  address: string;
  email: string;
  username: string | null;
  customer_id: string | null;
  avatarDataUrl?: string | null;
};

const storageKey = "customer_session_v1";

export async function loadCustomerSession(): Promise<CustomerSession | null> {
  const raw = await AsyncStorage.getItem(storageKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CustomerSession;
  } catch {
    await AsyncStorage.removeItem(storageKey);
    return null;
  }
}

export async function saveCustomerSession(
  session: CustomerSession,
): Promise<void> {
  await AsyncStorage.setItem(storageKey, JSON.stringify(session));
}

export async function clearCustomerSession(): Promise<void> {
  await AsyncStorage.removeItem(storageKey);
}
