"use client";
import { useState } from "react";
import QRCode from "qrcode.react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:3000";

export default function Dashboard() {
  const [payload, setPayload] = useState<{
    cafeId: string;
    nonce: string;
    expires: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    setError(null);
    const r = await fetch(`${API_BASE}/qr/issue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: 60 }),
    });
    if (!r.ok) {
      setError(await r.text());
      return;
    }
    const p = await r.json();
    setPayload(p);
  }

  const qrData = payload
    ? JSON.stringify({ type: "STAMP_REQUEST", ...payload })
    : "";

  return (
    <div className="p-6 max-w-xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">Café Dashboard</h1>
      <button onClick={issue} className="px-4 py-2 rounded bg-black text-white">
        Jetzt Stempel-QR erzeugen
      </button>
      {error && <div className="text-red-600">{String(error)}</div>}
      {payload && (
        <div className="space-y-2">
          <div className="text-sm text-gray-600">
            Gültig bis: {new Date(payload.expires * 1000).toLocaleTimeString()}
          </div>
          <div className="bg-white p-4 rounded shadow inline-block">
            <QRCode value={qrData} size={220} includeMargin={true} />
          </div>
          <pre className="text-xs bg-gray-100 p-2 rounded">{qrData}</pre>
        </div>
      )}
    </div>
  );
}
