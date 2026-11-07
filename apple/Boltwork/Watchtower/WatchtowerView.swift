import BoltworkKit
import SwiftUI

/// The security report: a score and the items that need attention, grouped by problem.
struct WatchtowerView: View {
    @Environment(AppModel.self) private var model
    @Binding var selection: String?
    @AppStorage(AppSettings.checkBreachedPasswords) private var checkBreaches = false
    @State private var report: WatchtowerReport?
    @State private var checkingBreaches = false

    var body: some View {
        List(selection: $selection) {
            if let report {
                Section {
                    WatchtowerScore(report: report)
                    Toggle("Check for breached passwords", isOn: $checkBreaches)
                } footer: {
                    Text("Looks up each password in Have I Been Pwned by sending only the first five characters of its SHA-1 hash. The password never leaves this device.")
                }
                ForEach(WatchtowerCheck.allCases.filter { report.count($0) > 0 }, id: \.self) { check in
                    Section {
                        ForEach(report.issues.filter { $0.check == check }) { issue in
                            if let item = model.item(id: issue.itemId) {
                                WatchtowerIssueRow(item: item, detail: issue.detail)
                                    .tag(item.id)
                            }
                        }
                    } header: {
                        Label(check.title, systemImage: check.symbol)
                    }
                }
                if report.issues.isEmpty {
                    ContentUnavailableView("All Clear", systemImage: "checkmark.shield", description: Text("Watchtower found nothing to fix."))
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Watchtower")
        .task(id: model.items) {
            report = Watchtower.run(items: model.items, pwnedCounts: model.pwnedCounts)
        }
        .task(id: checkBreaches) {
            guard checkBreaches else { return }
            await lookUpBreaches()
        }
        .overlay(alignment: .bottom) {
            if checkingBreaches {
                Label("Checking passwords…", systemImage: "network")
                    .padding(8)
                    .background(.regularMaterial, in: .capsule)
                    .padding()
            }
        }
    }

    /// Fetches breach counts for passwords not yet checked, then recomputes the report.
    private func lookUpBreaches() async {
        checkingBreaches = true
        defer { checkingBreaches = false }
        await model.lookUpBreaches()
        report = Watchtower.run(items: model.items, pwnedCounts: model.pwnedCounts)
    }
}
