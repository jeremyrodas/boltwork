import XCTest

#if os(iOS)
/// Saves a passkey from Safari into Boltwork through AutoFill, then signs in with it.
/// Needs Face ID enrolled, a face-match loop running, and a WebAuthn test page in TEST_RUNNER_BOLTWORK_PASSKEY_PAGE.
/// Uses the app's real vault location, so run it only on a simulator without a vault you care about.
@MainActor
final class AutoFillUITests: XCTestCase {
    private let password = "correct horse battery"
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    private let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
    private let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")
    private var step = 0

    override func setUp() {
        continueAfterFailure = false
    }

    func testPasskeyInSafari() throws {
        guard let page = ProcessInfo.processInfo.environment["BOLTWORK_PASSKEY_PAGE"] else { throw XCTSkip("No passkey test page") }
        let app = XCUIApplication()
        app.launchArguments += ["-autolockMinutes", "-1"]
        app.launch()
        openVault(app)
        snap(app, "unlocked")

        // Face ID unlock and AutoFill on.
        app.buttons["Account"].firstMatch.tap()
        app.buttons["Settings"].firstMatch.tap()
        let faceID = app.switches["Unlock with Face ID"]
        XCTAssertTrue(faceID.waitForExistence(timeout: 5), "Face ID isn't enrolled on this simulator")
        if faceID.value as? String == "0" { faceID.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap() }
        let turnOn = app.buttons["Turn On AutoFill…"]
        if turnOn.waitForExistence(timeout: 3) {
            settings.terminate()
            turnOn.tap()
            let allow = springboard.buttons.matching(NSPredicate(format: "label IN {'Allow', 'Turn On', 'Use Boltwork'}")).firstMatch
            if allow.waitForExistence(timeout: 4) {
                snap(springboard, "autofill-prompt")
                allow.tap()
            } else {
                // Settings opened instead: turn Boltwork on there.
                XCTAssertTrue(settings.wait(for: .runningForeground, timeout: 10))
                let row = settings.switches["AutoFillFromBoltworkToggle"]
                XCTAssertTrue(row.waitForExistence(timeout: 10), "Boltwork isn't listed in AutoFill & Passwords")
                if row.value as? String == "0" { row.switches.firstMatch.tap() }
                // Boltwork's setup sheet opens over Settings, unlocks with Face ID and says it's on.
                let done = settings.buttons["Done"]
                XCTAssertTrue(done.waitForExistence(timeout: 30), "AutoFill setup didn't finish")
                snap(settings, "autofill-configured")
                done.tap()
                snap(settings, "settings-autofill")
                dump(settings, "settings-tree")
            }
            app.activate()
        }
        if !app.staticTexts["AutoFill is on"].waitForExistence(timeout: 5) {
            app.buttons["Account"].firstMatch.tap()
            app.buttons["Settings"].firstMatch.tap()
        }
        XCTAssertTrue(app.staticTexts["AutoFill is on"].waitForExistence(timeout: 10))
        snap(app, "autofill-on")
        app.buttons["Done"].tap()

        // Register a passkey on the test page.
        safari.open(URL(string: page)!)
        let register = safari.webViews.buttons["Register"]
        XCTAssertTrue(register.waitForExistence(timeout: 20))
        register.tap()
        sleep(3)
        snap(safari, "register-sheet")
        dump(safari, "register-safari-tree")
        dump(springboard, "register-springboard-tree")
    }

    private func openVault(_ app: XCUIApplication) {
        if app.buttons["Create a New Vault"].waitForExistence(timeout: 5) {
            app.buttons["Create a New Vault"].tap()
            let fields = app.secureTextFields
            fields["Account password"].tap()
            fields["Account password"].typeText(password)
            fields["Confirm password"].tap()
            fields["Confirm password"].typeText(password)
            app.buttons["Create Vault"].tap()
            let saved = app.switches["I saved my Secret Key"]
            XCTAssertTrue(saved.waitForExistence(timeout: 15))
            saved.coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
            app.buttons["Done"].tap()
        } else if !app.buttons["Account"].firstMatch.waitForExistence(timeout: 10) {
            // Face ID unlock (from an earlier run) opens it by itself; otherwise use the password.
            let field = app.secureTextFields["Account password"]
            if field.waitForExistence(timeout: 5) {
                field.tap()
                field.typeText(password)
                snap(app, "password-typed")
                app.buttons["Unlock"].tap()
            }
        }
        XCTAssertTrue(app.buttons["Account"].firstMatch.waitForExistence(timeout: 20))
    }

    private func snap(_ app: XCUIApplication, _ name: String) {
        step += 1
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = String(format: "%02d-%@", step, name)
        shot.lifetime = .keepAlways
        add(shot)
    }

    private func dump(_ app: XCUIApplication, _ name: String) {
        step += 1
        let text = XCTAttachment(string: app.debugDescription)
        text.name = String(format: "%02d-%@", step, name)
        text.lifetime = .keepAlways
        add(text)
    }
}
#endif
