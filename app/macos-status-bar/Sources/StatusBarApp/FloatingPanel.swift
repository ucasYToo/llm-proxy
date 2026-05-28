import AppKit

final class FloatingPanel: NSPanel {
    private let visualEffectView: NSVisualEffectView

    init(contentRect: NSRect) {
        visualEffectView = NSVisualEffectView(frame: contentRect)
        super.init(
            contentRect: contentRect,
            styleMask: [.titled, .closable, .nonactivatingPanel, .fullSizeContentView, .utilityWindow],
            backing: .buffered,
            defer: false
        )

        titlebarAppearsTransparent = true
        titleVisibility = .hidden
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        isMovableByWindowBackground = false
        isReleasedWhenClosed = false
        hidesOnDeactivate = false
        isFloatingPanel = true
        animationBehavior = .utilityWindow
        minSize = NSSize(width: 420, height: 520)

        standardWindowButton(.closeButton)?.isHidden = true
        standardWindowButton(.miniaturizeButton)?.isHidden = true
        standardWindowButton(.zoomButton)?.isHidden = true

        visualEffectView.material = .sidebar
        visualEffectView.state = .active
        visualEffectView.blendingMode = .behindWindow
        visualEffectView.wantsLayer = true
        visualEffectView.layer?.cornerRadius = 16
        visualEffectView.layer?.masksToBounds = true
        contentView = visualEffectView
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    func setContentSubview(_ view: NSView) {
        view.translatesAutoresizingMaskIntoConstraints = false
        visualEffectView.subviews.forEach { $0.removeFromSuperview() }
        visualEffectView.addSubview(view)

        NSLayoutConstraint.activate([
            view.leadingAnchor.constraint(equalTo: visualEffectView.leadingAnchor),
            view.trailingAnchor.constraint(equalTo: visualEffectView.trailingAnchor),
            view.topAnchor.constraint(equalTo: visualEffectView.topAnchor),
            view.bottomAnchor.constraint(equalTo: visualEffectView.bottomAnchor),
        ])
    }

    func position(relativeTo statusButton: NSStatusBarButton) {
        guard
            let buttonWindow = statusButton.window,
            let screen = buttonWindow.screen ?? NSScreen.main
        else { return }

        let buttonFrame = buttonWindow.convertToScreen(
            statusButton.convert(statusButton.bounds, to: nil)
        )
        let screenFrame = screen.visibleFrame
        let margin: CGFloat = 10
        let spacing: CGFloat = 8

        var originX = buttonFrame.midX - (frame.width / 2)
        originX = max(screenFrame.minX + margin, min(originX, screenFrame.maxX - frame.width - margin))

        var originY = buttonFrame.minY - frame.height - spacing
        if originY < screenFrame.minY + margin {
            originY = buttonFrame.maxY + spacing
        }

        setFrameOrigin(NSPoint(x: originX, y: originY))
    }
}
