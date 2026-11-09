#if os(macOS)
import XCTest

/// The Mac's SSH agent and browser link in the real app: makes a vault with an SSH key, turns both on, and
/// approves the requests a client script sends (ssh-keygen signing through the agent, and the browser host
/// pairing). Run with `TEST_RUNNER_BOLTWORK_MAC_LINK=1` while that script runs; it writes the browser
/// registration into installed browsers' folders and serves `~/.boltwork/browser.sock`.
@MainActor
final class MacLinkUITests: XCTestCase {
    private let password = "correct horse battery"

    override func setUp() {
        continueAfterFailure = false
    }

    func testSSHAgentAndBrowserLink() throws {
        guard ProcessInfo.processInfo.environment["BOLTWORK_MAC_LINK"] != nil else { throw XCTSkip("Needs the client script") }
        let app = XCUIApplication()
        // A folder inside the app's own container, which its sandbox can write.
        let home = String(cString: getpwuid(getuid())!.pointee.pw_dir)
        let dir = home + "/Library/Containers/app.boltwork.apple/Data/tmp/boltwork-uitest-\(UUID().uuidString)"
        app.launchArguments += ["-vaultDirectory", dir, "-autolockMinutes", "-1", "-sshAgent", "YES", "-browserLink", "YES"]
        app.launch()

        app.buttons["Create a New Vault"].click()
        let fields = app.secureTextFields
        // Mac secure fields show their placeholder but carry no label, so go by order.
        XCTAssertTrue(fields.element(boundBy: 0).waitForExistence(timeout: 10))
        fields.element(boundBy: 0).click()
        fields.element(boundBy: 0).typeText(password)
        fields.element(boundBy: 1).click()
        fields.element(boundBy: 1).typeText(password)
        app.buttons["Create Vault"].click()
        // The sheet's only switch; on the Mac its label is a separate text.
        let saved = app.sheets.firstMatch.switches.firstMatch
        XCTAssertTrue(saved.waitForExistence(timeout: 15))
        saved.click()
        let done = app.buttons["Done"]
        XCTAssertTrue(done.wait(for: \.isEnabled, toEqual: true, timeout: 5))
        done.click()

        // An SSH key, made by the app.
        let newItem = app.menuButtons["Add"].firstMatch
        XCTAssertTrue(newItem.waitForExistence(timeout: 10))
        newItem.click()
        app.menuItems["SSH Key"].firstMatch.click()
        let title = app.textFields["Title"]
        XCTAssertTrue(title.waitForExistence(timeout: 5))
        title.click()
        title.typeText("Test Deploy Key")
        app.buttons["Generate New Ed25519 Key"].firstMatch.click()
        attach(app, "ssh-key-editor")
        app.buttons["Save"].firstMatch.click()

        // The client script signs with the agent, then pairs a browser; approve each prompt as it comes.
        let allow = app.buttons["Allow"].firstMatch
        XCTAssertTrue(allow.waitForExistence(timeout: 180), "the agent asked before signing")
        attach(app, "ssh-prompt")
        allow.click()
        // Show the browser link's state in Settings.
        app.typeKey(",", modifierFlags: .command)
        let browserTab = app.toolbars.buttons["Browser"].firstMatch
        if browserTab.waitForExistence(timeout: 5) { browserTab.click() }
        attach(app, "browser-settings")
        app.typeKey("w", modifierFlags: .command)
        let connect = app.buttons["Connect"].firstMatch
        XCTAssertTrue(connect.waitForExistence(timeout: 180), "the app asked before a browser connected")
        attach(app, "browser-prompt")
        connect.click()
        // Leave the app running while the script finishes its requests.
        sleep(20)
        attach(app, "end")
    }

    private func attach(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
#endif
