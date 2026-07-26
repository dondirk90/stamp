import Capacitor
import UIKit

// Capacitor's own CAPBridgeViewController hardcodes
// `webView.scrollView.bounces = false` (see CAPBridgeViewController.swift in
// the Capacitor pod) with no config option to override it - that's why the
// native app feels rigid on overscroll while the same page in a normal
// mobile browser bounces normally. Re-enable it after Capacitor's own setup
// runs.
class MainViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        webView?.scrollView.bounces = true

        // The WKWebView's own background defaults to black, so the
        // rubber-band overscroll area flashes black at the top/bottom
        // instead of matching the app's page background (--color-background
        // in theme.css). Match it so the bounce blends in.
        let appBackground = UIColor(red: 0xf7 / 255.0, green: 0xf4 / 255.0, blue: 0xef / 255.0, alpha: 1.0)
        view.backgroundColor = appBackground
        webView?.isOpaque = true
        webView?.backgroundColor = appBackground
        webView?.scrollView.backgroundColor = appBackground
    }

    // Registers our local OAuthSessionPlugin (not a separate npm/Cocoapod
    // package, so it needs manual registration) - capacitorDidLoad() is
    // Capacitor's documented hook for exactly this.
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(OAuthSessionPlugin())
    }
}
