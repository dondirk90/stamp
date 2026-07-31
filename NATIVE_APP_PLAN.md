# Kaffeekarte Native App Plan

Stand: 31.07.2026. Dieser Plan war ursprünglich für einen Expo/React-Native-Rewrite
geschrieben. Tatsächlich umgesetzt wurde ein schlankerer Weg: die nativen Apps sind
Capacitor-Wrapper im **Remote-URL-Modus** um die bestehende Web-App
(`apps/customer-qr-modern.html`, `apps/cafe-scanner-new.html` + `cafe-profile.html`).
Die native Shell lädt einfach die echte, deployte Seite - jeder Web-Deploy aktualisiert
die App sofort, ohne neue Store-Einreichung. Alle Screens (Wallet, QR, Discovery,
Historie, Scanner, Stempeln, Einlösen, Profil) existieren dadurch bereits.

Die alten Expo-Stubs `apps/customer-ios-new` und `apps/cafe-ios-new` sind **nicht mehr
im Einsatz** und werden von keinem Build/Workflow mehr referenziert - können bei
Gelegenheit gelöscht werden.

Aktueller Fokus laut Absprache: **erst iOS fertig bekommen**, Android folgt danach.

## Stack

- Capacitor (iOS + Android) um die bestehende Web-App
- Fastlane für Build + Store-Upload (`apps/customer-native/fastlane`, `apps/cafe-native/fastlane`)
- GitHub Actions, aktuell nur manuell startbar (`workflow_dispatch`):
  - `.github/workflows/build-ios-customer.yml`
  - `.github/workflows/build-ios-cafe.yml`
  - `.github/workflows/build-android-customer.yml` (Café-Android-Workflow existiert noch nicht)

## Produktaufteilung

- **Customer App** (`app.kaffeekarte.customer`, Anzeigename "Kaffeekarte") - Gäste
- **Café App** (`app.kaffeekarte.cafe`, Anzeigename "Kaffeekarte Barista") - Betreiber/Staff

## Stand: erledigt

- [x] App-Namen festgelegt (Customer: "Kaffeekarte", Café: "Kaffeekarte Barista")
- [x] Bundle IDs festgelegt (`app.kaffeekarte.customer` / `app.kaffeekarte.cafe`)
- [x] App-Icons für iOS + Android generiert (beide Apps)
- [x] Splash-Screens für iOS + Android generiert (beide Apps)
- [x] Remote-URL-Konfiguration (Staging/Prod-Umschaltung über `CAP_SERVER_URL`, siehe `capacitor.config.ts`)
- [x] Alle MVP-Screens vorhanden (kommen 1:1 aus der Web-App)
- [x] Fastlane-Lanes geschrieben (`certificates`, `build`, `beta` für iOS; `beta` für Android)
- [x] Apple Developer Account eingerichtet und aktiv
- [x] Echte Geräte-Tests auf iPhone gemacht
- [x] Code auf `main` gemerged

## Nächste Schritte: iOS fertig bekommen

- [x] App Store Connect API Key erzeugt und als GitHub Secrets hinterlegt
- [x] Privates Git-Repo für `fastlane match` angelegt + Secrets hinterlegt
- [x] App-Einträge in App Store Connect angelegt (Customer + Café)
- [x] `build-ios-customer.yml` und `build-ios-cafe.yml` erfolgreich manuell ausgelöst, TestFlight-Builds bestätigt
- [ ] App Store Screenshots erstellen (beide Apps) - **letzter offener Punkt**
- [ ] App Store Beschreibungstexte schreiben (beide Apps)
- [ ] Privacy-Policy-Link hinterlegen (liegt schon als Seite vor: `apps/datenschutz.html`)
- [ ] Nach erfolgreichem manuellem Test: Workflows ggf. von `workflow_dispatch` auf
      Push-Trigger umstellen (z. B. bei Tag-Push wie beim Prod-Deploy)

## Danach: Android

- [x] Google Play Console: Account vorhanden
- [x] Upload-Keystore erzeugt, Secrets hinterlegt (`ANDROID_KEYSTORE_BASE64`,
      `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`)
- [ ] Google Play App Signing für beide Apps aktivieren
- [ ] Play-Console-Service-Account-Key erzeugen, als `PLAY_JSON_KEY` hinterlegen
- [ ] App-Einträge einmalig in der Play Console anlegen (Customer + Café) -
      **nur der Account-Inhaber kann das**, kein Automatisierungsschritt
- [x] Café-Android-Workflow gebaut (`build-android-cafe.yml`), inkl. der
      bisher fehlenden `platform :android`-Lane in `cafe-native/fastlane/Fastfile`
- [ ] `build-android-customer.yml` und `build-android-cafe.yml` einmal manuell
      auslösen, internen Test-Track kontrollieren
- [ ] Store-Assets (Screenshots, Beschreibung) für Play Store

## Aufräumen (unkritisch, kein Blocker)

- [ ] `apps/customer-ios-new` und `apps/cafe-ios-new` (alte Expo-Stubs) löschen oder
      klar als "nicht mehr verwendet" markieren
