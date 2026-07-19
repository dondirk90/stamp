# Kaffeekarte — Brand Guidelines

Stand: Juli 2026. Dieses Dokument ist die verbindliche Referenz für alle Marken-Entscheidungen:
Landingpage, Customer-App, Café-App, Wallet-Karten, Aufsteller, Sticker, Social Media.
Was hier steht, wurde entschieden. Was hier nicht steht, wird hier ergänzt — nicht ad hoc improvisiert.

---

## 1. Markenkern

**Kaffeekarte ist keine digitale Stempelkarte. Kaffeekarte ist die Marke der lokalen Specialty-Coffee-Community.**

Die Kernbotschaft lautet nicht „Sammle Punkte", sondern:

> **Unterstütze die Cafés, die guten Kaffee machen.**

Die Karte ist nur das Werkzeug. Die Geschichte sind die Cafés, die Menschen dahinter und die Stadt.

### Zielgruppe

Menschen, die …

- am Wochenende extra für einen Flat White durch die Stadt fahren
- verschiedene Röstereien kennen und Cafés als dritten Ort zwischen Zuhause und Büro sehen
- Nachhaltigkeit mögen, aber nicht darüber belehrt werden wollen
- Design lieben und Apple Wallet selbstverständlich nutzen
- eher Oatly, Patagonia und Moleskine mögen als Payback

**Nicht** für: Casual-Kaffeetrinker, Instagram-Tourismus, Ketten, Rabatt-Jäger.

### Referenzrahmen

Anfühlen wie: Aesop, Vitsœ, Linear, Notion, Oatly, Fellow, Blue Bottle, The Barn, Bonanza, Coffee Collective.
Niemals wie: Starbucks, Payback, DeutschlandCard.

Minimal. Still. Viel Weißraum. Keine Werbesprache.

---

## 2. Name & Claim

- **Markenname: Kaffeekarte.** Keine Varianten, keine Stadtteil-Präfixe („Sülzer Kaffeekarte" ist Alt-Branding und wurde entfernt), kein „Kaffeeklub", kein „Stamp".
- **Kicker/Herkunftszeile: „Kaffee im Veedel"** — bewusst kölsch, hyperlokal, anti-hype. Steht klein über dem Markennamen, nie allein.
- **Claim (primär, DE):** „Dein Lieblingscafé. Immer dabei."
- **Claim (sekundär/EN, für Aufsteller & Sticker):** „Good coffee deserves better loyalty."
- **Manifest-Zeile (nur wir können das sagen):** „Mehr Cafégefühl, weniger Interface."

---

## 3. Logo

Die Kaffeebohne (`/assets/stamp-bean.png`). Ruhig, wertig, handwerklich. Drei Varianten sind zu entwickeln:

| Variante | Einsatz |
| --- | --- |
| **Filled** (Ist-Stand) | App-Icons, Favicon, Topbars |
| **Outline** (nur Kontur) | Wasserzeichen, Sticker, dunkle Flächen |
| **Stempel** (leicht unregelmäßige Struktur) | Aufsteller, Print, Merch — der handwerkliche Specialty-Gedanke |

Regeln: Logo nie verzerren, nie einfärben außerhalb der Palette, nie als dekoratives Wallpaper wiederholen
(maximal **ein** dezentes Bohnen-Wasserzeichen pro Ansicht).

---

## 4. Farben

### Zielpalette (Soll)

Keine typischen Kaffeefarben-Flächen. **Viel Weiß, Braun nur als Akzent.**

| Token | Hex | Rolle |
| --- | --- | --- |
| Warm White | `#F7F4EF` | Flächen, Hintergründe — dominiert jede Ansicht |
| Graphite | `#232323` | Text, Icons |
| Espresso | `#4A3728` | Akzent: primäre CTAs, Stempel, aktive Zustände |
| Sage | `#B7C2A8` | Sekundärer Akzent: Erfolg, Bestätigung |
| Terracotta | `#B96B52` | Sekundärer Akzent: Hinweise, Wärme — sparsam |

Dazu bleibt der **dunkle Espresso-Modus** (`theme-invert`, `#211712`-Basis) als bewusster Kontrast:
Café-Arbeitsmodus und die Manifest-Sektion der Landingpage. Systemlogik: **Gäste = hell, Caféalltag = dunkel.**

### Ist-Stand & Migration

`apps/theme.css` ist die einzige Quelle für Farbwerte (`--color-*`-Tokens). Sage (`#aeb7a0`) und
Terracotta (`#b76e52`) existieren dort bereits nahezu identisch. Die Migration ist eine Token-Umstellung,
kein Rewrite:

1. `--color-background` → Warm White, getönte Creme-Verläufe auf Flächen zurücknehmen
2. Braun aus Flächen/Karten herausziehen, nur noch in CTAs, Stempeln, aktiven Zuständen
3. Beide Apps + Landing gegen die neuen Tokens sichten (Screenshots vorher/nachher)

**Timing: nach dem Livegang als eigenes Arbeitspaket, nicht davor.**

---

## 5. Typografie

| Ebene | Schrift | Einsatz |
| --- | --- | --- |
| **Marke & große Headlines** | Serif (`--font-serif`: Iowan Old Style / Palatino / Georgia) | Logo-Wortmarke, Hero-Headlines, Manifest, Café-Namen auf Profil & Karten |
| **UI & Fließtext** | Sans (`--font-sans`: Geist / Inter / System) | Alles andere: Labels, Buttons, Beschreibungen |
| **Kicker/Labels** | Sans, 11px, 900, letter-spacing 0.12–0.16em, Uppercase | Sektions-Kicker, Fact-Labels |

Serif ist das Markensignal und bleibt selten: Begrüßung, Café-Namen, Headlines. Nie für UI-Labels oder Buttons.
Enges Letter-Spacing bei Serif-Headlines (−0.04 bis −0.06em), Zeilenhöhe unter 1.0 für Display-Größen.

---

## 6. Sprache & Tonalität

**Ton:** wissend, zurückhaltend, echt. Nie werblich, nie trendig-anbiedernd, keine Emojis in Produkttexten,
keine Ausrufezeichen-Kaskaden.

| ✓ So | ✗ Nicht so |
| --- | --- |
| „Heute schon guten Kaffee getrunken?" | „Sammle jetzt Punkte!" |
| „7 von 10 Stempeln — noch 3 bis zu deinem nächsten Cortado" | „You're almost there!! 🎉" |
| „Dein Stammcafé verdient Stammgäste." | „Find your fave! ☕️ #caffelife" |
| „Schön, dass du wieder da bist." | „Willkommen zurück, Sparfuchs!" |
| „Entdecke ehrliche Kaffees mit echten Stories" | „Die Loyalty-Revolution ist da" |

Fehlermeldungen und Empty States dürfen Persönlichkeit haben („Vielleicht spricht das Café lieber durch
den Espresso."), aber nie Witzchen auf Kosten der Klarheit.

---

## 7. Bildsprache

- Café-Fotos: Schwarzweiß oder entsättigt/gedeckt — **keine** grelle Instagram-Ästhetik
- Barista-Porträts: echt, nicht gestylt — Handwerk zeigen, nicht Lifestyle
- Brüh-Details: Crema, Pour-over, Latte Art nur wenn authentisch fürs Café
- Keine Stockfotos. Lieber gar kein Bild als ein generisches.

Pro Café gepflegt (kuratiert, nicht user-generated): 2–3 Hero-Fotos, 1 Absatz Story (warum es dieses Café
gibt), Rösterei-Partner, Brühmethoden, Öffnungszeiten, optional Instagram/Website.

---

## 8. UI-Prinzipien & Komponenten

- **Weißraum vor Dekoration.** Wenige Container; nicht jede Info braucht eine Karte mit Badge.
  Maximal eine Badge-Zeile pro Sektion.
- **Stempel sind Bohnen:** `● ● ● ○ ○ ○ ○ ○ ○ ○` — gefüllte Bohnen-Punkte, nie nackte „3/10"-Brüche.
  Der Zähler („7 von 10 Stempeln") begleitet als Text, ersetzt die Bohnen nicht.
- **Buttons:** Primär = Espresso-Fläche, weiße Schrift, Pill. Sekundär = helle Fläche mit Kontur.
  Pro Ansicht genau **ein** primärer CTA. Button-Texte sagen, was passiert („Karte holen",
  „Zur Stempelkarte") — nie zwei Buttons, deren Unterschied man erklären müsste.
- **Karten (UI):** weiche Radien (20–34px), dezente Schatten, Glass-Effekt sparsam.
- **QR-Codes:** groß, zentriert, mindestens 200×200px auf Mobile. QR ist eine Aktion (Modal/Sheet),
  kein eigenes Ziel in der Navigation.
- **Kurzprofil vs. Vollprofil (Café):** Das Kurzprofil (Modal auf der Map) ist die schnelle
  Entscheidungsbasis und zeigt genau: Logo, Name, Adresse, Status („Schon/Neu bei deinen Karten"),
  Reward-Zyklus, **ein** Bild, die Story als 3-Zeilen-Teaser und die Aktionen („Karte holen" bzw.
  „Zur Stempelkarte"/QR, dazu „Café ansehen"). Das Vollprofil (`/cafe-public`) trägt alles andere:
  Bildergalerie, die ganze Story, Belohnung, Standort mit Route, Website und Instagram.
  Kein Inhalt erscheint in beiden Ebenen in voller Länge.
- **Dark = Arbeit:** Der dunkle Espresso-Modus gehört dem Café (Scanner, Theke) und dem Manifest.
  Gäste-Flows bleiben hell.

---

## 9. Microinteractions

Sparsam, aber spürbar — sie machen den Unterschied zwischen Tool und Marke:

- Neuer Stempel: Bohne „ploppt" auf (Scale-Bounce ~200ms), optional kurze Haptik (Vibration API)
- Karte voll: Celebration-Moment — kurz, warm, nicht albern; Redemption-QR unterscheidet sich
  sichtbar vom Sammel-QR
- Nicht jede Belohnung ist ein Rabatt: nach dem fünften Kaffee darf auch einfach
  „Schön, dass du wieder da bist." erscheinen
- `prefers-reduced-motion` wird respektiert (ist in `theme.css` bereits verdrahtet)

---

## 10. Anwendungen

### Onboarding (radikal reduziert, keine Tutorials)

1. **KAFFEEKARTE** — „Belohnungen für guten Kaffee." →
2. „QR scannen." →
3. „Karte im Wallet." → Fertig.

### Aufsteller (Theke)

Bohne (Stempel-Variante) · **KAFFEEKARTE** · „Good coffee deserves better loyalty." · QR · „Kostenlos starten".
Mehr nicht. Die Leute sollen fragen: „Was ist das?"

### Social Media

Keine Werbung — Cafékultur: Best Flat White in Köln, neue Röstung bei X, Barista-Stories, Brew Guides,
Community-Spotlight (ein Café pro Woche). Kaffeekarte wird Teil der Szene, nicht ihr Sponsor.

---

## 11. Umsetzungs-Roadmap

| Phase | Inhalt | Timing |
| --- | --- | --- |
| 0 | Livegang mit konsistentem Ist-Stand (Creme-Palette, Serif-Signale, ein Name) | jetzt |
| 1 | Farb-Token-Migration in `theme.css` (Warm White dominant, Braun als Akzent), Logo-Varianten (Outline, Stempel) | nach Livegang |
| 2 | Microinteractions (Stempel-Pop, Haptik, Celebration), reduziertes Onboarding | danach |
| 3 | Content-Aufbau: Café-Stories, Fotografie, Aufsteller & Sticker, Instagram-Vorlagen | parallel zu 1–2 |

Jede Phase wird mit Vorher/Nachher-Screenshots abgenommen, bevor die nächste startet.
