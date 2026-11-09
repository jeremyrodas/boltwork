import XCTest

/// Visits each main screen of a demo vault and keeps screenshots, for reviewing the design.
/// Runs only when pointed at a demo vault: `TEST_RUNNER_BOLTWORK_DEMO_VAULT=<dir> xcodebuild test …`
/// (make one with `BOLTWORK_DEMO_VAULT=<dir> swift test --filter DemoVault`).
@MainActor
final class ScreenshotTour: XCTestCase {
    func testTour() throws {
        guard let demo = ProcessInfo.processInfo.environment["BOLTWORK_DEMO_VAULT"] else {
            throw XCTSkip("Set TEST_RUNNER_BOLTWORK_DEMO_VAULT to a demo vault to run the tour.")
        }
        // Work on a copy, so the demo stays the same between runs.
        let dir = NSTemporaryDirectory() + "boltwork-tour-\(UUID().uuidString)"
        try FileManager.default.copyItem(atPath: demo, toPath: dir)

        let app = XCUIApplication()
        app.launchArguments += ["-vaultDirectory", dir, "-autolockMinutes", "-1"]
        app.launch()
        let password = app.secureTextFields["Account password"]
        XCTAssertTrue(password.waitForExistence(timeout: 10))
        password.tap()
        password.typeText("demo password")
        // Asked for only until this simulator has saved the demo vault's Secret Key.
        let key = app.textFields.firstMatch
        if key.exists {
            key.tap()
            key.typeText("SR1-ABCDEF-GHJKM-NPQRS-TVWXY-Z0123")
        }
        app.buttons["Unlock"].tap()

        XCTAssertTrue(app.staticTexts["Favorites"].waitForExistence(timeout: 15))
        shot(app, "1-home")

        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Northwind Bank, ")).firstMatch.tap()
        XCTAssertTrue(app.staticTexts["alex.rivera"].waitForExistence(timeout: 5))
        shot(app, "2-detail")
        app.navigationBars.buttons.firstMatch.tap()

        app.tabBars.buttons["Items"].firstMatch.exists ? app.tabBars.buttons["Items"].tap() : app.buttons["Items"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Code Forge"].waitForExistence(timeout: 5))
        shot(app, "3-items")
        app.staticTexts["Code Forge"].tap()
        XCTAssertTrue(app.staticTexts["arivera"].waitForExistence(timeout: 5))
        shot(app, "4-items-detail")

        app.tabBars.buttons["Watchtower"].firstMatch.exists ? app.tabBars.buttons["Watchtower"].tap() : app.buttons["Watchtower"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Overall Password Strength"].waitForExistence(timeout: 10))
        shot(app, "5-watchtower")

        // Switching appearance repaints the open Settings sheet straight away.
        app.buttons["Account"].firstMatch.tap()
        app.buttons["Settings"].firstMatch.tap()
        let dark = app.buttons["Dark"].firstMatch
        XCTAssertTrue(dark.waitForExistence(timeout: 5))
        dark.tap()
        shot(app, "6-settings-dark")
        app.buttons["System"].firstMatch.tap()
        shot(app, "7-settings-system")
    }

    private func shot(_ app: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
