import BoltworkKit
import SwiftUI

/// Random, memorable and PIN passwords. With a `target`, "Use Password" puts the result into that field.
struct GeneratorView: View {
    var target: Binding<String>?
    @Environment(\.dismiss) private var dismiss
    @State private var options = GeneratorView.savedOptions
    @State private var password = ""

    var body: some View {
        Form {
            Section {
                Text(password)
                    .font(.title3.monospaced())
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, minHeight: 60, alignment: .leading)
                StrengthMeter(strength: PasswordStrength(password))
                HStack {
                    Button("Regenerate", systemImage: "arrow.clockwise", action: regenerate)
                    Spacer()
                    Button("Copy", systemImage: "doc.on.doc") { Clipboard.copy(password, secret: true) }
                }
                .buttonStyle(.bordered)
            }
            Section {
                Picker("Type", selection: $options.mode) {
                    Text("Random").tag(GeneratorMode.characters)
                    Text("Memorable").tag(GeneratorMode.words)
                    Text("PIN").tag(GeneratorMode.pin)
                }
                .pickerStyle(.segmented)
                switch options.mode {
                case .characters:
                    LabeledContent("Length: \(options.length)") {
                        Slider(value: $options.sliderLength, in: 8...64, step: 1)
                    }
                    Toggle("Numbers", isOn: $options.digits)
                    Toggle("Symbols", isOn: $options.symbols)
                    Toggle("Avoid look-alike characters", isOn: $options.avoidAmbiguous)
                case .words:
                    Stepper("Words: \(options.wordCount)", value: $options.wordCount, in: 3...15)
                    Picker("Separator", selection: $options.separator) {
                        Text("Hyphens").tag(WordSeparator.hyphens)
                        Text("Spaces").tag(WordSeparator.spaces)
                        Text("Periods").tag(WordSeparator.periods)
                        Text("Underscores").tag(WordSeparator.underscores)
                        Text("Numbers").tag(WordSeparator.digits)
                        Text("Numbers and Symbols").tag(WordSeparator.digitsAndSymbols)
                    }
                    Toggle("Capitalize", isOn: $options.capitalize)
                    Toggle("Full words", isOn: $options.fullWords)
                case .pin:
                    Stepper("Digits: \(options.pinLength)", value: $options.pinLength, in: 3...12)
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Password Generator")
        .toolbar {
            if let target {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Use Password") {
                        target.wrappedValue = password
                        dismiss()
                    }
                }
            }
            ToolbarItem(placement: .cancellationAction) {
                Button(target == nil ? "Done" : "Cancel") { dismiss() }
            }
        }
        .onAppear(perform: regenerate)
        .onChange(of: options) {
            Self.save(options)
            regenerate()
        }
        #if os(macOS)
        .frame(minWidth: 440, minHeight: 440)
        #endif
    }

    private func regenerate() {
        password = PasswordGenerator.generate(options)
    }

    private static var savedOptions: GeneratorOptions {
        UserDefaults.standard.data(forKey: AppSettings.generatorOptions).flatMap { try? JSONDecoder().decode(GeneratorOptions.self, from: $0) } ?? GeneratorOptions()
    }

    private static func save(_ options: GeneratorOptions) {
        UserDefaults.standard.set(try? JSONEncoder().encode(options), forKey: AppSettings.generatorOptions)
    }
}
