// Add debug logging to award button
const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "../apps/cafe-scanner-new.html");
let content = fs.readFileSync(filePath, "utf8");

const oldCode = `      awardBtn.onclick = async () => {
        if (!scannedCustomer || !cafe) return;

        const amount = parseInt(stampAmount.value) || 1;
        awardBtn.disabled = true;
        awardBtn.textContent = "Wird vergeben...";

        try {
          const res = await fetch(apiBase + "/stamp-by-cafe", {`;

const newCode = `      awardBtn.onclick = async () => {
        if (!scannedCustomer || !cafe) return;

        const amount = parseInt(stampAmount.value) || 1;
        console.log("Award attempt:", { cafe, apiKey: cafe.apiKey, customer: scannedCustomer.address });
        awardBtn.disabled = true;
        awardBtn.textContent = "Wird vergeben...";

        try {
          const res = await fetch(apiBase + "/stamp-by-cafe", {`;

if (content.includes(oldCode)) {
  content = content.replace(oldCode, newCode);
  fs.writeFileSync(filePath, content, "utf8");
  console.log("✅ Added debug logging to award button");
  console.log("🔄 Hard refresh browser (Ctrl+F5) to reload");
} else {
  console.log("⚠️ Pattern not found - may already be patched or code changed");
}
