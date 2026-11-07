import AuthenticationServices
import SwiftUI

/// The system's entry points into Boltwork AutoFill. Each one records the request; `AutoFillView` unlocks the
/// vault and finishes it through `complete(_:)`.
final class CredentialProviderViewController: ASCredentialProviderViewController {
    private let session = AutoFillSession()

    override func viewDidLoad() {
        super.viewDidLoad()
        session.finish = { [weak self] in self?.complete($0) }
        let host = HostingController(rootView: AutoFillView(session: session))
        addChild(host)
        host.view.frame = view.bounds
        #if os(iOS)
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
        #else
        host.view.autoresizingMask = [.width, .height]
        view.addSubview(host.view)
        preferredContentSize = CGSize(width: 440, height: 520)
        #endif
    }

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier]) {
        session.request = .list(serviceIdentifiers, passkey: nil)
    }

    override func prepareCredentialList(for serviceIdentifiers: [ASCredentialServiceIdentifier], requestParameters: ASPasskeyCredentialRequestParameters) {
        session.request = .list(serviceIdentifiers, passkey: requestParameters)
    }

    /// The vault is locked whenever the extension starts, so filling always needs Face ID or Touch ID first.
    override func provideCredentialWithoutUserInteraction(for credentialRequest: any ASCredentialRequest) {
        complete(.cancelled(.userInteractionRequired))
    }

    override func prepareInterfaceToProvideCredential(for credentialRequest: any ASCredentialRequest) {
        session.request = .provide(credentialRequest)
    }

    override func prepareInterface(forPasskeyRegistration registrationRequest: any ASCredentialRequest) {
        if let request = registrationRequest as? ASPasskeyCredentialRequest {
            session.request = .register(request)
        } else {
            complete(.cancelled(.failed))
        }
    }

    override func prepareInterfaceForExtensionConfiguration() {
        session.request = .configure
    }

    private func complete(_ outcome: AutoFillSession.Outcome) {
        switch outcome {
        case .password(let credential): extensionContext.completeRequest(withSelectedCredential: credential, completionHandler: nil)
        case .assertion(let credential): extensionContext.completeAssertionRequest(using: credential, completionHandler: nil)
        case .registration(let credential): extensionContext.completeRegistrationRequest(using: credential, completionHandler: nil)
        case .configured: extensionContext.completeExtensionConfigurationRequest()
        case .cancelled(let code): extensionContext.cancelRequest(withError: NSError(domain: ASExtensionErrorDomain, code: code.rawValue))
        }
    }
}

#if os(iOS)
private typealias HostingController = UIHostingController
#else
private typealias HostingController = NSHostingController
#endif
