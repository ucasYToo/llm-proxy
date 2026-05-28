import AppKit
import WebKit

final class WebViewPanel: NSView, WKNavigationDelegate, WKUIDelegate {
    private let webView: WKWebView
    private let placeholderLabel: NSTextField
    private let baseURL: URL

    override init(frame: NSRect) {
        baseURL = URL(string: "http://localhost:\(PortConfig.port)/#panel")!

        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        webView = WKWebView(frame: frame, configuration: config)

        placeholderLabel = NSTextField(labelWithString: "服务未运行")
        placeholderLabel.font = .systemFont(ofSize: 14, weight: .medium)
        placeholderLabel.textColor = .secondaryLabelColor
        placeholderLabel.alignment = .center
        placeholderLabel.isHidden = true

        super.init(frame: frame)

        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.setValue(false, forKey: "drawsBackground")

        addSubview(webView)
        addSubview(placeholderLabel)

        webView.translatesAutoresizingMaskIntoConstraints = false
        placeholderLabel.translatesAutoresizingMaskIntoConstraints = false

        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: trailingAnchor),
            webView.topAnchor.constraint(equalTo: topAnchor),
            webView.bottomAnchor.constraint(equalTo: bottomAnchor),

            placeholderLabel.centerXAnchor.constraint(equalTo: centerXAnchor),
            placeholderLabel.centerYAnchor.constraint(equalTo: centerYAnchor),
        ])
    }

    private var hasLoaded = false

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError() }

    func loadIfNeeded() {
        if hasLoaded { return }
        hasLoaded = true
        placeholderLabel.isHidden = true
        webView.isHidden = false
        webView.load(URLRequest(url: baseURL))
    }

    func forceReload() {
        placeholderLabel.isHidden = true
        webView.isHidden = false
        webView.load(URLRequest(url: baseURL))
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showPlaceholder()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showPlaceholder()
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            NSWorkspace.shared.open(url)
        }
        return nil
    }

    private func showPlaceholder() {
        webView.isHidden = true
        placeholderLabel.isHidden = false
        hasLoaded = false
    }
}
