import XCTest

/// Drives the real app through the main flow: create a vault, add a login, find it, lock and unlock.
@MainActor
final class VaultFlowUITests: XCTestCase {
    private let password = "correct horse battery"

    override func setUp() {
        continueAfterFailure = false
    }

    func testCreateAddLockUnlock() throws {
        let app = launchWithNewVault()

        // Add a login.
        openItemsList(app)
        app.buttons["New Item"].firstMatch.tap()
        app.buttons["Login"].firstMatch.tap()
        let title = app.textFields["Title"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        title.tap()
        title.typeText("Example Bank")
        app.textFields["username"].tap()
        app.textFields["username"].typeText("alice@example.com")
        app.textFields["password"].tap()
        app.textFields["password"].typeText("Tr0ub4dor&3-much-longer")
        attach(app, "editor")
        app.buttons["Save"].tap()
        XCTAssertFalse(app.buttons["Not Now"].waitForExistence(timeout: 2), "iOS offered to save the item into Passwords")

        // It's in the list and its details show.
        XCTAssertTrue(app.staticTexts["Example Bank"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["alice@example.com"].firstMatch.waitForExistence(timeout: 5))
        app.buttons["Reveal"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Tr0ub4dor&3-much-longer"].firstMatch.waitForExistence(timeout: 5), "the whole password was saved")
        attach(app, "detail")

        // Lock, then unlock with the password.
        lock(app)
        let unlockField = app.secureTextFields["Account password"]
        XCTAssertTrue(unlockField.waitForExistence(timeout: 5))
        attach(app, "locked")
        unlockField.tap()
        unlockField.typeText(password)
        app.buttons["Unlock"].tap()
        openItemsList(app)
        XCTAssertTrue(app.staticTexts["Example Bank"].firstMatch.waitForExistence(timeout: 15))
        attach(app, "unlocked")
    }

    #if os(iOS)
    func testSecretKeyAndEmergencyKitNeedPassword() throws {
        let app = launchWithNewVault()
        // Settings is on the sidebar.
        let back = app.navigationBars.buttons["BackButton"]
        if back.waitForExistence(timeout: 5) { back.tap() }
        app.buttons["Settings"].firstMatch.tap()
        app.buttons["Secret Key and Emergency Kit"].tap()

        // Nothing shows until the password is right.
        let field = app.secureTextFields["Account password"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        XCTAssertFalse(app.buttons["Create Emergency Kit…"].exists)
        field.tap()
        field.typeText("wrong password")
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.staticTexts["That password isn’t right."].waitForExistence(timeout: 15))
        field.tap()
        field.typeText(password)
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Secret Key: S R 1'")).firstMatch.waitForExistence(timeout: 15))
        attach(app, "secret-key-revealed")

        // The kit takes a confirmed extra step.
        XCTAssertFalse(app.buttons["Save or Print Emergency Kit"].exists)
        app.buttons["Create Emergency Kit…"].tap()
        app.buttons["Create Emergency Kit"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Save or Print Emergency Kit"].waitForExistence(timeout: 10))
        attach(app, "emergency-kit")

        // Leaving forgets it: coming back asks for the password again.
        app.navigationBars.buttons.firstMatch.tap()
        app.buttons["Secret Key and Emergency Kit"].tap()
        XCTAssertTrue(app.secureTextFields["Account password"].waitForExistence(timeout: 5))
    }
    #endif

    /// Creates a vault in a fresh folder and saves its Secret Key.
    private func launchWithNewVault() -> XCUIApplication {
        let app = XCUIApplication()
        let dir = NSTemporaryDirectory() + "boltwork-uitest-\(UUID().uuidString)"
        app.launchArguments += ["-vaultDirectory", dir, "-autolockMinutes", "-1"]
        app.launch()

        app.buttons["Create a New Vault"].tap()
        let fields = app.secureTextFields
        fields["Account password"].tap()
        fields["Account password"].typeText(password)
        fields["Confirm password"].tap()
        fields["Confirm password"].typeText(password)
        app.buttons["Create Vault"].tap()

        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'Secret Key: S R 1'")).firstMatch.waitForExistence(timeout: 15))
        let saved = app.switches["I saved my Secret Key"]
        #if os(iOS)
        // Tap the switch itself; the row's center is its label.
        saved.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        #else
        saved.click()
        #endif
        attach(app, "secret-key")
        let done = app.buttons["Done"]
        XCTAssertTrue(done.wait(for: \.isEnabled, toEqual: true, timeout: 5))
        done.tap()
        return app
    }

    /// On iPhone the split view starts at the sidebar; open All Items.
    private func openItemsList(_ app: XCUIApplication) {
        let allItems = app.buttons["All Items"].firstMatch
        if allItems.waitForExistence(timeout: 5), !app.buttons["New Item"].firstMatch.exists {
            allItems.tap()
        }
    }

    private func lock(_ app: XCUIApplication) {
        #if os(macOS)
        app.typeKey("l", modifierFlags: [.command, .shift])
        #else
        // Back to the sidebar, where the Lock button is.
        while !app.buttons["Lock"].exists, app.navigationBars.buttons.firstMatch.exists {
            app.navigationBars.buttons.firstMatch.tap()
        }
        app.buttons["Lock"].tap()
        #endif
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
