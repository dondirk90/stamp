import Capacitor

// Both native apps load the exact same remote origin (see capacitor.config.ts
// - server.url has to be a bare origin), so shared pages like index.html
// can't otherwise tell which native shell they're running in to redirect to
// the right starting screen. This plugin only exists in the café app; its
// mere presence (checked from JS) is the signal - the customer app has no
// equivalent plugin, so it falls through to its existing /wallet redirect
// unchanged (see index.html).
@objc(AppIdentityPlugin)
public class AppIdentityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppIdentityPlugin"
    public let jsName = "AppIdentity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "whoAmI", returnType: CAPPluginReturnPromise),
    ]

    @objc func whoAmI(_ call: CAPPluginCall) {
        call.resolve(["appId": "cafe"])
    }
}
