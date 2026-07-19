import { webBaseUrl } from "@/lib/config";
import type { CustomerSession } from "@/lib/session";

const redeemTokenByKey = new Map<string, { token: string; ts: number }>();
const REDEEM_TOKEN_TTL_MS = 5 * 60 * 1000;

function randomHex(len = 16): string {
  const n = Math.max(8, Math.min(64, len));
  let out = "";
  for (let i = 0; i < n; i += 1) {
    out += ((Math.random() * 256) | 0).toString(16).padStart(2, "0");
  }
  return out;
}

function buildScannerUrl(session: CustomerSession, cafeAddress: string): URL {
  const url = new URL(`${webBaseUrl}/cafe-scanner-new.html`);
  url.searchParams.set("customer", session.address);
  url.searchParams.set("customerName", session.username || "");
  if (cafeAddress) url.searchParams.set("cafe", cafeAddress);
  return url;
}

export function buildStampLink(
  session: CustomerSession,
  cafeAddress: string,
): string {
  return buildScannerUrl(session, cafeAddress).toString();
}

export function buildRedeemLink(
  session: CustomerSession,
  cafeAddress: string,
): string {
  const url = buildScannerUrl(session, cafeAddress);
  url.searchParams.set("action", "redeem");

  const key = `${session.address.toLowerCase()}|${cafeAddress.toLowerCase()}`;
  const now = Date.now();
  let cached = redeemTokenByKey.get(key);
  if (!cached || now - cached.ts > REDEEM_TOKEN_TTL_MS) {
    cached = { token: randomHex(16), ts: now };
    redeemTokenByKey.set(key, cached);
  }
  url.searchParams.set("rt", cached.token);

  return url.toString();
}
