/// A just-created Secret Key, to present in a sheet.
struct NewSecretKey: Identifiable {
    let value: String
    var id: String { value }
}
