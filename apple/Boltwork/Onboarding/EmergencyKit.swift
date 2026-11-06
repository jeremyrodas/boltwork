import SwiftUI

/// Renders the Emergency Kit page to a PDF in a temporary folder.
enum EmergencyKit {
    static func render(secretKey: String, server: String?, email: String?) -> URL? {
        let url = URL.temporaryDirectory.appending(path: "Boltwork Emergency Kit.pdf")
        let renderer = ImageRenderer(content: EmergencyKitPage(secretKey: secretKey, server: server, email: email))
        var ok = false
        renderer.render { size, draw in
            var box = CGRect(origin: .zero, size: size)
            guard let pdf = CGContext(url as CFURL, mediaBox: &box, nil) else { return }
            pdf.beginPDFPage(nil)
            draw(pdf)
            pdf.endPDFPage()
            pdf.closePDF()
            ok = true
        }
        return ok ? url : nil
    }
}
