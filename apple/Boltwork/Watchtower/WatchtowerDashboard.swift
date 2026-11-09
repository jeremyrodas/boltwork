import BoltworkKit
import SwiftUI

/// The Watchtower tab: the score, password strength, and a card for each kind of problem.
struct WatchtowerDashboard: View {
    @Environment(AppModel.self) private var model
    @Binding var sheet: BrowserSheet?
    @AppStorage(AppSettings.checkBreachedPasswords) private var checkBreaches = false
    @State private var report: WatchtowerReport?
    @State private var checkingBreaches = false

    private var passwords: [String] {
        model.items.filter { $0.state == .active }.compactMap { $0.content.field(for: .password)?.value }.filter { !$0.isEmpty }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                if let report {
                    ScoreGauge(score: report.score, label: report.scoreLabel)
                    Text("Watchtower looks for weak, reused and exposed passwords and other risks. Fix the flagged items to raise your score.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 480)
                    StrengthBreakdown(passwords: passwords)
                    let checks = WatchtowerCheck.allCases.filter { report.count($0) > 0 }
                    if checks.isEmpty {
                        Label("All clear. Watchtower found nothing to fix.", systemImage: "checkmark.shield.fill")
                            .foregroundStyle(Theme.good)
                            .padding(16)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .card()
                    } else {
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 160), spacing: 12)], spacing: 12) {
                            ForEach(checks, id: \.self) { check in
                                NavigationLink(value: check) {
                                    IssueCountCard(check: check, count: report.count(check))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Toggle("Check for breached passwords", isOn: $checkBreaches)
                        Text("Sends only the first five characters of each password’s SHA-1 hash to Have I Been Pwned. Your passwords never leave this device.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .padding(16)
                    .card()
                } else {
                    ProgressView().padding(.top, 80)
                }
            }
            .padding()
            .frame(maxWidth: 820)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        .navigationTitle("Watchtower")
        .navigationDestination(for: WatchtowerCheck.self) { check in
            WatchtowerIssuesList(check: check, issues: report?.issues.filter { $0.check == check } ?? [])
        }
        .toolbar {
            #if os(iOS)
            ToolbarItem(placement: .topBarLeading) {
                AccountMenu(sheet: $sheet)
            }
            #endif
        }
        .overlay(alignment: .bottom) {
            if checkingBreaches {
                Label("Checking passwords…", systemImage: "network")
                    .padding(8)
                    .background(.regularMaterial, in: .capsule)
                    .padding()
            }
        }
        .task(id: model.items) {
            report = Watchtower.run(items: model.items, pwnedCounts: model.pwnedCounts)
        }
        .task(id: checkBreaches) {
            guard checkBreaches else { return }
            checkingBreaches = true
            defer { checkingBreaches = false }
            await model.lookUpBreaches()
            report = Watchtower.run(items: model.items, pwnedCounts: model.pwnedCounts)
        }
    }
}
