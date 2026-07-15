export type CustomerSession = {
  address: string;
  email: string;
  username: string | null;
  customer_id: string | null;
  avatarDataUrl?: string | null;
};

const storageKey = "customer_session_v1";

let memorySession: CustomerSession | null = null;

export async function loadCustomerSession(): Promise<CustomerSession | null> {
  if (memorySession) return memorySession;

  if (typeof localStorage !== "undefined") {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    try {
      memorySession = JSON.parse(raw) as CustomerSession;
      return memorySession;
    } catch {
      localStorage.removeItem(storageKey);
    }
  }

  return null;
}

export async function saveCustomerSession(
  session: CustomerSession,
): Promise<void> {
  memorySession = session;
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(storageKey, JSON.stringify(session));
  }
}

export async function clearCustomerSession(): Promise<void> {
  memorySession = null;
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(storageKey);
  }
}
