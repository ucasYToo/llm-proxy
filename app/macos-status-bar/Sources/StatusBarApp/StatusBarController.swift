import AppKit

final class StatusBarController {
    private let statusItem: NSStatusItem
    private let panel: FloatingPanel
    private let webViewPanel: WebViewPanel
    private var pollTimer: Timer?
    private var statusPollTimer: Timer?
    private var blinkTimer: Timer?
    private var eventMonitor: Any?
    private let apiBaseURL = "http://localhost:\(PortConfig.port)"

    private enum SessionStatus: String {
        case idle
        case running
        case waiting
    }

    private var currentStatus: SessionStatus = .idle
    private var blinkVisible = true

    init() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        panel = FloatingPanel(contentRect: NSRect(x: 0, y: 0, width: 520, height: 700))
        webViewPanel = WebViewPanel(frame: .zero)

        configureStatusItem()
        panel.setContentSubview(webViewPanel)
        startPolling()
        startStatusPolling()
    }

    func teardown() {
        pollTimer?.invalidate()
        statusPollTimer?.invalidate()
        blinkTimer?.invalidate()
        if let eventMonitor {
            NSEvent.removeMonitor(eventMonitor)
        }
    }

    private func configureStatusItem() {
        guard let button = statusItem.button else { return }

        updateStatusImage(.idle)
        button.imagePosition = .imageLeading
        button.title = " --"
        button.target = self
        button.action = #selector(handleClick(_:))
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
    }

    private func updateStatusImage(_ status: SessionStatus) {
        guard let button = statusItem.button else { return }

        let config = NSImage.SymbolConfiguration(pointSize: 14, weight: .regular)
        if let arrow = NSImage(systemSymbolName: "arrow.up.arrow.down.circle", accessibilityDescription: "LLM Proxy")?
            .withSymbolConfiguration(config) {
            arrow.isTemplate = true
            button.image = arrow
        }

        let tokenText = button.title.trimmingCharacters(in: .whitespaces)
        let prefix: String
        switch status {
        case .idle:    prefix = "⚪︎"
        case .running: prefix = "🟢"
        case .waiting: prefix = "🔴"
        }
        if tokenText.isEmpty || tokenText.hasPrefix("●") || tokenText.hasPrefix("⚪") || tokenText.hasPrefix("🟢") || tokenText.hasPrefix("🔴") {
            button.title = " \(prefix)"
        }
    }

    private func startPolling() {
        fetchTokens()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            self?.fetchTokens()
        }
    }

    private func startStatusPolling() {
        fetchStatus()
        statusPollTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            self?.fetchStatus()
        }
    }

    private func fetchStatus() {
        guard let url = URL(string: "\(apiBaseURL)/api/query?type=status") else { return }

        let task = URLSession.shared.dataTask(with: url) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self else { return }
                guard
                    let data,
                    let httpResponse = response as? HTTPURLResponse,
                    httpResponse.statusCode == 200
                else {
                    self.updateStatus(.idle)
                    return
                }
                self.parseStatus(data)
            }
        }
        task.resume()
    }

    private func parseStatus(_ data: Data) {
        guard
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let statusStr = json["status"] as? String,
            let status = SessionStatus(rawValue: statusStr)
        else {
            updateStatus(.idle)
            return
        }

        updateStatus(status)
    }

    private func updateStatus(_ status: SessionStatus) {
        let oldStatus = currentStatus
        currentStatus = status

        // Only update image if status changed or blink state changed
        if oldStatus != status {
            updateStatusImage(status)
            updateBlinkTimer()
        }
    }

    private func updateBlinkTimer() {
        blinkTimer?.invalidate()
        blinkTimer = nil

        // Blink for running and waiting states
        if currentStatus == .running || currentStatus == .waiting {
            blinkVisible = true
            blinkTimer = Timer.scheduledTimer(withTimeInterval: 0.8, repeats: true) { [weak self] _ in
                guard let self else { return }
                self.blinkVisible.toggle()
                self.updateStatusImage(self.currentStatus)
            }
        } else {
            blinkVisible = true
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
                    self.statusItem.button?.title = " --"
                    return
                }
                self.parseCostSummary(data)
            }
        }
        task.resume()
    }

    private func parseCostSummary(_ data: Data) {
        guard
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let byTarget = json["byTarget"] as? [[String: Any]]
        else {
            statusItem.button?.title = " --"
            return
        }

        var totalTokens = 0
        for target in byTarget {
            totalTokens += target["totalTokens"] as? Int ?? 0
        }

        statusItem.button?.title = " \(formatTokens(totalTokens))"
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

extension NSImage {
    func tinted(with color: NSColor) -> NSImage {
        let image = self.copy() as! NSImage
        image.lockFocus()

        color.set()

        let imageRect = NSRect(origin: .zero, size: image.size)
        imageRect.fill(using: .sourceAtop)

        image.unlockFocus()
        image.isTemplate = false

        return image
    }
}
