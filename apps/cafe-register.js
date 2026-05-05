// (Optional) If you prefer to split JS, this file is ready.
// Currently the HTML inlines the script; we keep this file for future expansion.
try {
  const sp = new URLSearchParams(location.search || "");
  const DEBUG =
    sp.get("debug") === "1" || localStorage.getItem("stamp_debug") === "1";
  if (DEBUG) console.log("cafe-register script loaded");
} catch (e) {}
