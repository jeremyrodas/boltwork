import BoltworkKit

extension GeneratorOptions {
    /// The length as a `Double`, for a slider.
    var sliderLength: Double {
        get { Double(length) }
        set { length = Int(newValue.rounded()) }
    }
}
