import Capacitor
import UIKit

// Same fixes as the customer app's MainViewController (see
// apps/customer-native/ios/App/App/MainViewController.swift for the full
// rationale) - Capacitor's CAPBridgeViewController hardcodes
// `webView.scrollView.bounces = false` with no config override, and the
// WKWebView's own background defaults to black instead of the app's page
// background.
class MainViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        webView?.scrollView.bounces = true

        // Cafe app pages run in theme.css's dark .theme-invert mode
        // (--bg: #211712), unlike the customer app's light background - the
        // overscroll fill has to match that instead.
        let appBackground = UIColor(red: 0x21 / 255.0, green: 0x17 / 255.0, blue: 0x12 / 255.0, alpha: 1.0)
        view.backgroundColor = appBackground
        webView?.isOpaque = true
        webView?.backgroundColor = appBackground
        webView?.scrollView.backgroundColor = appBackground
    }

    // server.url must be a bare origin (see capacitor.config.ts - a path
    // there breaks in-app navigation to every other page, a fix already
    // proven on the customer app). That means this app cold-starts on the
    // guest marketing page instead of the barista login/scanner screen.
    // A client-side redirect in index.html can't tell this app apart from
    // the customer app (both load the exact same origin), so send it to the
    // right place here instead, once per launch after the bridge is ready.
    override func capacitorDidLoad() {
        webView?.evaluateJavaScript(
            "if (location.pathname === '/' || location.pathname === '/index.html') { location.replace('/cafe-scanner'); }"
        )
    }
}
