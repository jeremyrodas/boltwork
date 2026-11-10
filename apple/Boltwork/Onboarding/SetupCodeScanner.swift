#if os(iOS)
import AVFoundation
import BoltworkKit
import SwiftUI
import VisionKit

/// The camera, looking for a setup code shown by another device.
struct SetupCodeScannerSheet: View {
    let onScan: (SetupCode) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var message: String?

    static var isSupported: Bool { DataScannerViewController.isSupported }

    /// Asks for the camera the first time. False if the person said no.
    static func cameraAllowed() async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: true
        case .notDetermined: await AVCaptureDevice.requestAccess(for: .video)
        default: false
        }
    }

    var body: some View {
        NavigationStack {
            SetupCodeScanner { text in
                do {
                    let code = try SetupCode(text)
                    onScan(code)
                    dismiss()
                } catch {
                    message = error.localizedDescription
                }
            }
            .ignoresSafeArea(edges: .bottom)
            .overlay(alignment: .bottom) {
                Text(message ?? "On a device that’s signed in, open Settings, then Set Up Another Device, and point the camera at the code.")
                    .font(.callout)
                    .multilineTextAlignment(.center)
                    .padding()
                    .background(.regularMaterial, in: .rect(cornerRadius: 12))
                    .padding()
            }
            .navigationTitle("Scan Setup Code")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}

private struct SetupCodeScanner: UIViewControllerRepresentable {
    let onText: (String) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(onText: onText) }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let scanner = DataScannerViewController(recognizedDataTypes: [.barcode(symbologies: [.qr])], isHighlightingEnabled: true)
        scanner.delegate = context.coordinator
        try? scanner.startScanning()
        return scanner
    }

    func updateUIViewController(_ scanner: DataScannerViewController, context: Context) {}

    static func dismantleUIViewController(_ scanner: DataScannerViewController, coordinator: Coordinator) {
        scanner.stopScanning()
    }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        let onText: (String) -> Void
        private var last: String?

        init(onText: @escaping (String) -> Void) { self.onText = onText }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            for case .barcode(let barcode) in addedItems {
                guard let text = barcode.payloadStringValue, text != last else { continue }
                last = text
                onText(text)
            }
        }
    }
}
#endif
