# Kaffeekarte Native App Plan

Dieser Plan beschreibt die nächsten Schritte für die Entwicklung der nativen Kaffeekarte-Apps.

Ziel ist nicht, die bestehende Web-App nur zu verpacken.
Ziel ist, aus Kaffeekarte zwei klare mobile Produkte zu bauen:

- eine Customer App für Gäste
- eine Café App für Betreiber und Staff

## Zielbild

Die nativen Apps sollen:

- dieselbe Marke wie die Web-App tragen
- dieselben Backend-APIs nutzen
- sich schneller, klarer und nativer anfühlen
- Kamera, QR und Navigation besser lösen als im Browser

## Architekturentscheidung

Empfohlener Stack:

- Expo / React Native

Warum:

- im Repo existieren bereits zwei Expo-Stubs
- QR, Kamera und Navigation profitieren von nativer UI
- iOS und Android können mit hohem Shared-Code-Anteil gebaut werden
- spätere Features wie Push, Deep Links und besseres Offline-Verhalten sind sauber möglich

Was bestehen bleibt:

- Backend und API
- Login- und Kartenlogik
- Stempel- und Reward-Modell

## Produktaufteilung

### Customer App

Ziel:

- Lieblingscafés sehen
- Kartenstand verstehen
- QR schnell öffnen
- neue Cafés entdecken
- Historie und Konto pflegen

### Café App

Ziel:

- schnell scannen
- Stempel vergeben
- Rewards einlösen
- Profil pflegen

## Realistische Reihenfolge

1. Customer App MVP
2. Customer App Testflight / Internal Testing
3. Café App MVP
4. Store-Polish und Native-Erweiterungen

Warum diese Reihenfolge:

- Customer ist das klarere Kernprodukt
- Customer liefert früher sichtbaren Produktwert
- Café Scanner kann danach gezielter und stabiler gebaut werden

## Was benötigt wird

### Produktentscheidungen

- finaler App-Name pro App
- Bundle IDs / Package Names
- App-Icons und Splash-Richtung
- Datenschutz- und Kameratexte
- Scope des ersten Releases

### Technische Grundlagen

- saubere Expo-Projekte
- gemeinsame API-Konfiguration für Staging und Prod
- Session-Handling
- Navigation-Struktur
- Design Tokens für Farben, Spacing, Typografie

### Accounts und Infrastruktur

- Apple Developer Account
- Google Play Developer Account
- Expo Account / EAS Setup
- GitHub Secrets für mobile Builds
- App-Store- und Play-Console-Einträge

### Assets und Inhalte

- App-Icons
- Splash-Screens
- Screenshots
- App-Beschreibungen
- Privacy Policy Links

## MVP-Scope

### Customer App MVP

Pflicht:

- Registrierung
- Login
- Session-Persistenz
- Wallet / Kartenübersicht
- direkter QR-Flow
- Historie
- Café-Suche / Discovery
- Café-Detail
- Konto

Nicht im ersten MVP notwendig:

- komplexe Animationen
- Push Notifications
- tiefe Offline-Funktionalität
- Apple Wallet / Google Wallet Integration

### Café App MVP

Pflicht:

- Login
- Scanner
- Scan Result
- Stempel vergeben
- Reward einlösen
- Basis-Profil

Nicht im ersten MVP notwendig:

- Analytics
- Marketing / Kampagnen
- tiefe Bildverwaltung
- erweiterte Admin-Funktionen

## Screen-Plan

### Customer App

1. Auth / Onboarding
- Registrierung zuerst
- Login als Option
- klare Value Proposition

2. Home / Wallet
- Kartenliste
- Fortschritt
- direkter QR-Einstieg

3. QR Sheet
- großer QR
- Café-Name
- Fortschritt
- klarer Close

4. Cafés entdecken
- Suche
- Liste oder Map
- Café öffnen

5. Café-Detail
- Beschreibung
- Adresse
- CTA: Karte holen / QR zeigen

6. Historie
- verständliche Events
- keine technische Sprache

7. Konto
- E-Mail
- Username
- Passwort ändern
- Logout

### Café App

1. Login
2. Scanner Home
3. Scan Result
4. Profil

## Größte Aufwände

Der größte Aufwand liegt nicht im Store-Deploy, sondern in:

- Wallet-/QR-UX sauber nativ bauen
- Session, Navigation und Fehlerstates robust machen
- Scanner-Flow stabil und schnell bekommen
- echtes Geräte-Testing auf iOS und Android

Technisch heikel:

- Kamera / QR
- Statuswechsel zwischen Kartenansicht, QR und History
- Auth-Persistenz
- Plattformunterschiede

## Umsetzungsplan

### Phase 1: Foundations

Ziel:

- aus den Expo-Stubs echte Projektbasen machen

Zu erledigen:

- Expo-Starterinhalte entfernen
- App-Namen und Slugs festlegen
- Bundle IDs und Schemes definieren
- Staging- und Prod-API-Config anlegen
- Basis-Navigation aufsetzen
- Design Tokens definieren

Benötigt:

- finale Produktnamen
- Bundle-ID-Entscheidung
- Farb- und Typografie-Richtung

Ergebnis:

- lauffähige Customer- und Café-App-Basis

### Phase 2: Customer MVP

Ziel:

- erstes wirklich benutzbares Native-Produkt

Zu erledigen:

- Auth-Screens bauen
- Session speichern
- Wallet-Liste anbinden
- QR-Sheet bauen
- Historie anbinden
- Discovery anbinden
- Konto-Screen bauen

Benötigt:

- stabile API-Endpunkte
- klare Fehlermeldungen
- Karten- und Historien-Datenmodell dokumentiert

Ergebnis:

- Customer App kann intern getestet werden

### Phase 3: Customer QA und Store-Vorbereitung

Ziel:

- Customer App auf Testgeräten stabil machen

Zu erledigen:

- iOS- und Android-Gerätetests
- UI-Polish
- App-Icons und Splash
- Screenshots
- Store-Texte
- EAS / Build-Pipeline
- TestFlight / Internal Testing

Benötigt:

- Apple Developer Account
- Google Play Account
- finale Assets

Ergebnis:

- Customer App bereit für erste externe Tests

### Phase 4: Café MVP

Ziel:

- zweites Produkt für Betreiber bauen

Zu erledigen:

- Betreiber-Login
- Scanner-Screen
- Scan Result Flow
- Stamp / Redeem Aktionen
- Profil-Basis

Benötigt:

- stabile Scan-/QR-Spezifikation
- gute Success-/Error-UX

Ergebnis:

- Café App intern einsatzfähig

### Phase 5: Native Mehrwerte

Ziel:

- aus funktional guten Apps richtig starke Apps machen

Zu erledigen:

- Push Notifications
- Deep Links
- bessere Offline-Strategien
- Kamera-/Scanner-Polish
- Performance-Pass

## Konkrete To-do-Liste

### A. Entscheidungen

- [ ] finalen Customer-App-Namen festlegen
- [ ] finalen Café-App-Namen festlegen
- [ ] Bundle ID für Customer festlegen
- [ ] Bundle ID für Café festlegen
- [ ] App-Icons und Splash-Stil festlegen

### B. Repo und Setup

- [ ] `apps/customer-ios-new` bereinigen
- [ ] `apps/cafe-ios-new` bereinigen
- [ ] gemeinsame API-Konfiguration definieren
- [ ] Environment-Handling für Staging/Prod ergänzen
- [ ] Shared Design Tokens anlegen

### C. Customer MVP

- [ ] Auth-Screens
- [ ] Session-Persistenz
- [ ] Wallet-Screen
- [ ] QR-Sheet
- [ ] Discovery-Screen
- [ ] Café-Detail
- [ ] History
- [ ] Konto

### D. Customer Release-Vorbereitung

- [ ] echte Geräte-Tests iPhone
- [ ] echte Geräte-Tests Android
- [ ] App-Icons exportieren
- [ ] Splash vorbereiten
- [ ] Screenshots erstellen
- [ ] Store-Beschreibung schreiben
- [ ] TestFlight Build
- [ ] Internal Android Build

### E. Café MVP

- [ ] Betreiber-Login
- [ ] Scanner Home
- [ ] Scan Result
- [ ] Stamp Action
- [ ] Redeem Action
- [ ] Profil-Basis

### F. Accounts und Builds

- [ ] Apple Developer Account einrichten
- [ ] Google Play Console einrichten
- [ ] Expo / EAS konfigurieren
- [ ] Signing sauber dokumentieren
- [ ] GitHub Secrets für mobile Builds setzen

## Definition of Done

### Customer MVP ist fertig, wenn

- Registrierung funktioniert
- Login funktioniert
- Wallet echte Karten lädt
- QR stabil öffnet
- Discovery echte Cafés zeigt
- Historie verständlich lesbar ist
- Konto nutzbar ist

### Café MVP ist fertig, wenn

- Login funktioniert
- Scanner stabil öffnet
- Scans korrekt erkannt werden
- Stempel und Rewards sauber verarbeitet werden
- Basis-Profil pflegbar ist

## Empfohlener nächster Schritt

Der sinnvollste Startpunkt ist:

1. `apps/customer-ios-new` als erstes echtes Projekt aufräumen
2. Expo-Standardseiten entfernen
3. Auth + Navigation als erste native Basis bauen

Damit entsteht sofort ein echter Produkt-Start statt nur weiterer Planung.
