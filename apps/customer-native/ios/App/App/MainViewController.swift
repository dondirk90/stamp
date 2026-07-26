import Capacitor

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
    }
}
