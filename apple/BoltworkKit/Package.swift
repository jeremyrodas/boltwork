// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "BoltworkKit",
    platforms: [.iOS(.v26), .macOS(.v26)],
    products: [
        .library(name: "BoltworkKit", targets: ["BoltworkKit"])
    ],
    targets: [
        .target(
            name: "BoltworkKit",
            resources: [.process("Generator/wordlist.txt")],
            swiftSettings: [
                // Argon2id over 128 MiB is far too slow unoptimized, even in Debug builds.
                .unsafeFlags(["-O"], .when(configuration: .debug))
            ]
        ),
        .testTarget(
            name: "BoltworkKitTests",
            dependencies: ["BoltworkKit"],
            resources: [.copy("Fixtures")]
        )
    ]
)
