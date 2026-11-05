import Cocoa
import SafariServices
import WebKit

class ViewController: NSViewController, WKNavigationDelegate, WKScriptMessageHandler {
    @IBOutlet var webView: WKWebView!

    private var extensionIdentifier: String {
        Bundle.main.object(forInfoDictionaryKey: "AsideExtensionIdentifier") as! String
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.navigationDelegate = self
        webView.configuration.userContentController.add(self, name: "controller")
        let page = Bundle.main.url(forResource: "Main", withExtension: "html")!
        webView.loadFileURL(page, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionIdentifier) { state, _ in
            guard let state else { return }
            DispatchQueue.main.async {
                webView.evaluateJavaScript("show(\(state.isEnabled))")
            }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame,
              message.body as? String == "open-preferences" else { return }
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionIdentifier) { error in
            DispatchQueue.main.async {
                // Keep the launcher open if Safari cannot open settings.
                if error != nil {
                    self.webView.evaluateJavaScript("showSettingsError()")
                } else {
                    NSApplication.shared.terminate(nil)
                }
            }
        }
    }
}
