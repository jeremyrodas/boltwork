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
        if !app.buttons["Reveal"].firstMatch.waitForExistence(timeout: 2) { app.staticTexts["Example Bank"].firstMatch.tap() }
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

    /// Needs a throwaway sync server: TEST_RUNNER_BOLTWORK_SYNC_SERVER=http://localhost:8796 (the simulator reaches the Mac at localhost).
    func testTurnSyncOnAndOff() throws {
        guard let server = ProcessInfo.processInfo.environment["BOLTWORK_SYNC_SERVER"] else { throw XCTSkip("No test sync server") }
        let app = launchWithNewVault()
        openSettings(app)
        let address = app.textFields["Server address"]
        for _ in 0..<6 where !address.isHittable { app.swipeUp() }
        XCTAssertTrue(address.isHittable, app.debugDescription)
        address.tap()
        address.typeText(server)
        app.textFields["Email"].tap()
        app.textFields["Email"].typeText("ui-\(Int(Date().timeIntervalSince1970))@example.test")
        app.secureTextFields["Account password"].firstMatch.tap()
        app.secureTextFields["Account password"].firstMatch.typeText(password)
        app.buttons["Turn On Sync"].tap()
        let stop = app.buttons["Stop Syncing This Device…"]
        XCTAssertTrue(stop.waitForExistence(timeout: 30), "sync turned on")
        attach(app, "sync-on")

        stop.tap()
        let confirm = app.buttons["Stop Syncing"]
        XCTAssertTrue(confirm.waitForExistence(timeout: 5), "asks to confirm")
        attach(app, "sync-confirm")
        confirm.tap()
        XCTAssertTrue(app.buttons["Turn On Sync"].waitForExistence(timeout: 15), "back to the connect form")
        sleep(3)
        XCTAssertTrue(app.buttons["Turn On Sync"].exists, "stays off")
        attach(app, "sync-off")
    }

    #if os(iOS)
    func testSecretKeyAndEmergencyKitNeedPassword() throws {
        let app = launchWithNewVault()
        openSettings(app)
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

    /// Needs Face ID enrolled on the simulator, and a face match sent while it waits:
    /// `xcrun simctl spawn booted notifyutil -p com.apple.BiometricKit_Sim.pearl.match`.
    func testUnlockWithFaceID() throws {
        let app = launchWithNewVault()
        openSettings(app)
        let toggle = app.switches["Unlock with Face ID"]
        XCTAssertTrue(toggle.waitForExistence(timeout: 5), "Face ID isn't enrolled on this simulator")
        toggle.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        XCTAssertEqual(toggle.value as? String, "1")
        app.buttons["Done"].tap()

        lock(app)
        // The first time, iOS asks whether Boltwork may use Face ID.
        let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").buttons["OK"]
        if allow.waitForExistence(timeout: 5) { allow.tap() }
        XCTAssertTrue(app.buttons["Account"].firstMatch.waitForExistence(timeout: 30), "Face ID unlocked the vault")
        XCTAssertFalse(app.secureTextFields["Account password"].exists)
        attach(app, "face-id-unlocked")
    }
    #endif

    /// Creates a vault in a fresh folder and saves its Secret Key.
    private func launchWithNewVault() -> XCUIApplication {
        let app = XCUIApplication()
        let dir = NSTemporaryDirectory() + "boltwork-uitest-\(UUID().uuidString)"
        app.launchArguments += ["-vaultDirectory", dir, "-autolockMinutes", "-1"]
        app.launch()

        // Wait out the welcome screen's entrance animation before tapping.
        let create = app.buttons["Create a New Vault"]
        XCTAssertTrue(create.wait(for: \.isHittable, toEqual: true, timeout: 10))
        create.tap()
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

    /// The Items tab on iPhone and iPad; the Mac shows the list already.
    private func openItemsList(_ app: XCUIApplication) {
        #if os(iOS)
        let tab = app.tabBars.buttons["Items"].exists ? app.tabBars.buttons["Items"] : app.buttons["Items"].firstMatch
        if tab.waitForExistence(timeout: 5) { tab.tap() }
        #endif
    }

    #if os(iOS)
    private func openSettings(_ app: XCUIApplication) {
        let account = app.buttons["Account"].firstMatch
        XCTAssertTrue(account.waitForExistence(timeout: 10))
        account.tap()
        app.buttons["Settings"].firstMatch.tap()
    }
    #endif

    private func lock(_ app: XCUIApplication) {
        #if os(macOS)
        app.typeKey("l", modifierFlags: [.command, .shift])
        #else
        // The Account menu lives on the Home tab.
        let home = app.buttons["Home"].firstMatch
        if !app.buttons["Account"].firstMatch.exists, home.exists { home.tap() }
        app.buttons["Account"].firstMatch.tap()
        app.buttons["Lock"].firstMatch.tap()
        #endif
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
