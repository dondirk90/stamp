import Capacitor
import AuthenticationServices

// Universal Links and a plain Safari redirect to our custom URL scheme both
// proved unreliable for the OAuth return trip (confirmed via staging logs
// and on-device diagnostics - see the plan/commit history around this
// file). ASWebAuthenticationSession is Apple's own API for exactly this
// case: it hands the final redirect URL straight to our completion
// handler in-process, with no dependency on AppDelegate or notifications
// ever firing.
@objc(OAuthSessionPlugin)
public class OAuthSessionPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "OAuthSessionPlugin"
    public let jsName = "OAuthSession"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "authenticate", returnType: CAPPluginReturnPromise),
    ]

    // Held strongly for the lifetime of the flow - ASWebAuthenticationSession
    // is torn down if nothing retains it, cancelling the login mid-flight.
    private var session: ASWebAuthenticationSession?

    @objc func authenticate(_ call: CAPPluginCall) {
        guard let urlString = call.getString("url"), let url = URL(string: urlString) else {
            call.reject("Missing or invalid 'url'")
            return
        }
        guard let scheme = call.getString("callbackUrlScheme"), !scheme.isEmpty else {
            call.reject("Missing 'callbackUrlScheme'")
            return
        }

        DispatchQueue.main.async {
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: scheme) { [weak self] callbackURL, error in
                self?.session = nil
                if let callbackURL = callbackURL {
                    call.resolve(["url": callbackURL.absoluteString])
                } else {
                    call.reject(error?.localizedDescription ?? "OAuth session cancelled")
                }
            }
            session.presentationContextProvider = self
            // Share the normal Safari cookie jar so an existing Google/Apple
            // sign-in gets reused instead of forcing a fresh login every time.
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            session.start()
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return self.bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }
}
