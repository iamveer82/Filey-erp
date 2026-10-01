import Darwin
import Foundation
import ImageIO
import Vision

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

guard CommandLine.arguments.count == 2 else {
    fail("Usage: check-mobile-screenshot <screenshot.png>")
}
let url = URL(fileURLWithPath: CommandLine.arguments[1])
guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fail("Could not read the simulator screenshot.")
}

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = ["en-US"]
do {
    try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
} catch {
    fail("Could not recognize screenshot text: \(error)")
}
let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
    .joined(separator: " ").lowercased()
    .replacingOccurrences(of: "[^a-z0-9]+", with: " ", options: .regularExpression)
guard text.contains("choose how your business data is stored") else {
    fail("Filey's storage-choice screen is not visible yet.")
}
print("Filey's storage-choice screen is visible.")
