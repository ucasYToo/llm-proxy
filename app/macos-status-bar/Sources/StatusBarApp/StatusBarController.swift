import AppKit

final class StatusBarController {
    private let statusItem: NSStatusItem
    private let panel: FloatingPanel
    private let webViewPanel: WebViewPanel
    private var pollTimer: Timer?
    private var activityTimer: Timer?
    private var blinkTimer: Timer?
    private var eventMonitor: Any?
    private let apiBaseURL = "http://localhost:\(PortConfig.port)"

    // 状态栏红绿灯状态
    private var tokenText = "--"
    private var activityState = "idle" // approval | running | recent | idle
    private var isBlinking = false
    private var blinkOn = true

    init() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        panel = FloatingPanel(contentRect: NSRect(x: 0, y: 0, width: 520, height: 700))
        webViewPanel = WebViewPanel(frame: .zero)

        configureStatusItem()
        panel.setContentSubview(webViewPanel)
        startPolling()
    }

    func teardown() {
        pollTimer?.invalidate()
        activityTimer?.invalidate()
        blinkTimer?.invalidate()
        if let eventMonitor {
            NSEvent.removeMonitor(eventMonitor)
        }
    }

    private func configureStatusItem() {
        guard let button = statusItem.button else { return }

        let image = NSImage(systemSymbolName: "arrow.up.arrow.down.circle", accessibilityDescription: "LLM Proxy")
        image?.isTemplate = true
        button.image = image
        button.imagePosition = .imageLeading
        button.target = self
        button.action = #selector(handleClick(_:))
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        render()
    }

    private func startPolling() {
        fetchTokens()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            self?.fetchTokens()
        }

        fetchActivity()
        activityTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            self?.fetchActivity()
        }

        blinkTimer = Timer.scheduledTimer(withTimeInterval: 0.6, repeats: true) { [weak self] _ in
            self?.tickBlink()
        }
    }

    private func fetchTokens() {
        guard let url = URL(string: "\(apiBaseURL)/api/query?type=cost-summary") else { return }

        let task = URLSession.shared.dataTask(with: url) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self else { return }
                guard
                    let data,
                    let httpResponse = response as? HTTPURLResponse,
                    httpResponse.statusCode == 200
                else {
                    self.tokenText = "--"
                    self.render()
                    return
                }
                self.parseCostSummary(data)
            }
        }
        task.resume()
    }

    private func parseCostSummary(_ data: Data) {
        guard
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            tokenText = "--"
            render()
            return
        }

        let todayTokens = json["todayTokens"] as? Int ?? 0
        tokenText = formatTokens(todayTokens)
        render()
    }

    private func formatTokens(_ count: Int) -> String {
        if count < 1_000 {
            return "\(count)"
        } else if count < 1_000_000 {
            let k = Double(count) / 1_000
            return k >= 100 ? "\(Int(k))K" : String(format: "%.1fK", k)
        } else {
            let m = Double(count) / 1_000_000
            return m >= 100 ? "\(Int(m))M" : String(format: "%.1fM", m)
        }
    }

    private func fetchActivity() {
        guard let url = URL(string: "\(apiBaseURL)/api/query?type=activity-status") else { return }

        let task = URLSession.shared.dataTask(with: url) { [weak self] data, response, _ in
            DispatchQueue.main.async {
                guard let self else { return }
                guard
                    let data,
                    let httpResponse = response as? HTTPURLResponse,
                    httpResponse.statusCode == 200,
                    let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                    let state = json["state"] as? String
                else {
                    self.activityState = "idle"
                    self.isBlinking = false
                    self.render()
                    return
                }
                self.activityState = state
                self.isBlinking = (json["blinking"] as? Bool) ?? (state == "approval" || state == "running")
                self.render()
            }
        }
        task.resume()
    }

    private func tickBlink() {
        guard isBlinking else {
            if !blinkOn {
                blinkOn = true
                render()
            }
            return
        }
        blinkOn.toggle()
        render()
    }

    private func render() {
        guard let button = statusItem.button else { return }
        let base = dotColor(for: activityState)
        let color = (isBlinking && !blinkOn) ? base.withAlphaComponent(0.2) : base

        let title = NSMutableAttributedString()
        title.append(NSAttributedString(string: "● ", attributes: [.foregroundColor: color]))
        title.append(NSAttributedString(string: tokenText, attributes: [.foregroundColor: NSColor.labelColor]))
        button.attributedTitle = title
    }

    private func dotColor(for state: String) -> NSColor {
        switch state {
        case "approval":
            return .systemRed
        case "running", "recent":
            return .systemGreen
        default:
            return .tertiaryLabelColor
        }
    }

    @objc
    private func handleClick(_ sender: Any?) {
        guard let event = NSApp.currentEvent else {
            togglePanel()
            return
        }

        switch event.type {
        case .rightMouseUp:
            showContextMenu()
        default:
            togglePanel()
        }
    }

    private func togglePanel() {
        if panel.isVisible {
            closePanel()
        } else {
            openPanel()
        }
    }

    private func openPanel() {
        guard let button = statusItem.button else { return }

        webViewPanel.loadIfNeeded()
        panel.position(relativeTo: button)
        panel.orderFrontRegardless()
        panel.makeKey()
        NSApp.activate(ignoringOtherApps: true)
        startEventMonitor()
    }

    private func closePanel() {
        panel.orderOut(nil)
        stopEventMonitor()
    }

    private func showContextMenu() {
        let menu = NSMenu()

        let openItem = NSMenuItem(title: "打开面板", action: #selector(openPanelFromMenu), keyEquivalent: "")
        openItem.target = self
        menu.addItem(openItem)

        let browserItem = NSMenuItem(title: "浏览器打开", action: #selector(openInBrowser), keyEquivalent: "b")
        browserItem.target = self
        menu.addItem(browserItem)

        menu.addItem(.separator())

        let quitItem = NSMenuItem(title: "退出", action: #selector(quit), keyEquivalent: "q")
        quitItem.target = self
        menu.addItem(quitItem)

        statusItem.menu = menu
        statusItem.button?.performClick(nil)
        statusItem.menu = nil
    }

    @objc private func openPanelFromMenu() { openPanel() }

    @objc private func openInBrowser() {
        if let url = URL(string: apiBaseURL) {
            NSWorkspace.shared.open(url)
        }
    }

    @objc private func quit() { NSApp.terminate(nil) }

    private func startEventMonitor() {
        guard eventMonitor == nil else { return }
        eventMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            DispatchQueue.main.async {
                self?.closePanel()
            }
        }
    }

    private func stopEventMonitor() {
        if let eventMonitor {
            NSEvent.removeMonitor(eventMonitor)
            self.eventMonitor = nil
        }
    }
}
