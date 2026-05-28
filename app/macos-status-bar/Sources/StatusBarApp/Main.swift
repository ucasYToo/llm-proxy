import AppKit

enum PortConfig {
    static var port: Int = {
        let args = CommandLine.arguments
        if let idx = args.firstIndex(of: "--port"), idx + 1 < args.count,
           let p = Int(args[idx + 1]) {
            return p
        }
        if let env = ProcessInfo.processInfo.environment["LLM_PROXY_PORT"],
           let p = Int(env) {
            return p
        }
        return 1998
    }()
}

@main
enum StatusBarApp {
    private static let appDelegate = AppDelegate()

    static func main() {
        let selfName = ProcessInfo.processInfo.processName
        let others = NSWorkspace.shared.runningApplications.filter {
            $0.localizedName == selfName && $0.processIdentifier != ProcessInfo.processInfo.processIdentifier
        }
        if !others.isEmpty {
            exit(0)
        }

        let app = NSApplication.shared
        app.delegate = appDelegate
        app.run()
    }
}
