const fallbackHost = "https://staging.kaffeekarte.app";

export const webBaseUrl = (
  process.env.EXPO_PUBLIC_WEB_BASE_URL?.trim() || fallbackHost
).replace(/\/$/, "");

export const apiBaseUrl = `${webBaseUrl}/api`;
