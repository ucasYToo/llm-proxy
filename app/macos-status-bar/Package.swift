// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "StatusBarApp",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "StatusBarApp",
            path: "Sources/StatusBarApp"
        ),
    ]
)
