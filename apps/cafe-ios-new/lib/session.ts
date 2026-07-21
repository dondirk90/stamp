import AsyncStorage from "@react-native-async-storage/async-storage";

export type CafeSession = {
  token: string;
  id: number | string;
  name: string | null;
  cafeAddress: string | null;
  email: string | null;
  locationAddress: string | null;
};

const storageKey = "cafe_session_v1";

export async function loadCafeSession(): Promise<CafeSession | null> {
  const raw = await AsyncStorage.getItem(storageKey);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CafeSession;
  } catch {
    await AsyncStorage.removeItem(storageKey);
    return null;
  }
}

export async function saveCafeSession(session: CafeSession): Promise<void> {
  await AsyncStorage.setItem(storageKey, JSON.stringify(session));
}

export async function clearCafeSession(): Promise<void> {
  await AsyncStorage.removeItem(storageKey);
}
