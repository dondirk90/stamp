/* Verifies that a logged-in cafe cannot award stamps for a QR that belongs to a different cafe.

   Usage:
     node scripts/verify-cross-cafe-stamp.cjs

   Requires API running on http://127.0.0.1:3000
*/

const base = process.env.API_BASE || "http://127.0.0.1:3000";

async function jfetch(path, { method = "GET", headers = {}, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, text, json };
}

function uniqEmail(prefix) {
  const t = Date.now();
  const r = Math.random().toString(16).slice(2, 8);
  return `${prefix}+${t}-${r}@example.com`;
}

async function registerCafe(name, email) {
  const { res, json, text } = await jfetch("/cafes/register-with-email", {
    method: "POST",
    body: {
      name,
      email,
      password: "password123",
      street: "Teststrasse",
      houseNumber: "1",
      postalCode: "10115",
      city: "Berlin",
      country: "DE",
    },
  });
  if (!res.ok) {
    throw new Error(`register failed (${res.status}): ${text}`);
  }
  if (!json || !json.ok || !json.token || !json.cafe || !json.cafe.cafeAddress) {
    throw new Error(`register unexpected response: ${text}`);
  }
  return { token: json.token, cafeAddress: json.cafe.cafeAddress, cafe: json.cafe };
}

(async () => {
  console.log("API:", base);

  const cafeAEmail = uniqEmail("cafeA");
  const cafeBEmail = uniqEmail("cafeB");

  const cafeA = await registerCafe("CafeA", cafeAEmail);
  const cafeB = await registerCafe("CafeB", cafeBEmail);

  console.log("CafeA:", cafeA.cafeAddress);
  console.log("CafeB:", cafeB.cafeAddress);

  // Cross-cafe stamp attempt: CafeA token, but qrCafe points to CafeB.
  const customer = "0x1111111111111111111111111111111111111111";
  const { res, text, json } = await jfetch("/stamp-by-cafe", {
    method: "POST",
    headers: { Authorization: `Bearer ${cafeA.token}` },
    body: {
      customer,
      customerName: "Test Customer",
      count: 1,
      qrCafe: cafeB.cafeAddress,
    },
  });

  console.log("cross-cafe stamp status:", res.status);
  console.log("response:", json || text);

  if (res.status !== 403 || !json || json.error !== "wrong_cafe") {
    throw new Error(
      `Expected 403 wrong_cafe, got ${res.status} ${(json && json.error) || ""}`
    );
  }

  console.log("OK: cross-cafe stamping is blocked (wrong_cafe).");
})().catch((e) => {
  console.error("FAILED:", e && e.stack ? e.stack : e);
  process.exit(1);
});
