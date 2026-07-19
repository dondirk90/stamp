export type ParsedScan = {
  address: string;
  name: string;
  cafe: string | null;
  cardId: string | null;
  action: "stamp" | "redeem";
  redeemToken: string | null;
};

export function parseScannedPayload(raw: string): ParsedScan | null {
  const value = String(raw || "").trim();
  if (!value) return null;

  try {
    const url = new URL(value);
    const customer = url.searchParams.get("customer");
    if (!customer) return null;

    const action = url.searchParams.get("action");

    return {
      address: customer,
      name: url.searchParams.get("customerName") || "Unbekannt",
      cafe: url.searchParams.get("cafe") || url.searchParams.get("qrCafe") || null,
      cardId:
        url.searchParams.get("cardId") ||
        url.searchParams.get("cid") ||
        url.searchParams.get("card") ||
        null,
      action: action === "redeem" ? "redeem" : "stamp",
      redeemToken:
        url.searchParams.get("rt") || url.searchParams.get("redeemToken") || null,
    };
  } catch {
    return null;
  }
}
