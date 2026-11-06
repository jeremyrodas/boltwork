import Foundation

/// Decrypted copies of attachments, for Quick Look and sharing. Kept in a private temporary folder and removed on lock.
enum AttachmentPreview {
    private static var folder: URL { URL.temporaryDirectory.appending(path: "attachment-previews") }

    static func write(_ data: Data, named name: String, id: String) throws -> URL {
        let dir = folder.appending(path: id)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let safeName = name.replacing("/", with: "-").replacing(":", with: "-")
        let url = dir.appending(path: safeName.isEmpty ? "attachment" : safeName)
        try data.write(to: url, options: [.atomic, .completeFileProtection])
        return url
    }

    static func clear() {
        try? FileManager.default.removeItem(at: folder)
    }
}
