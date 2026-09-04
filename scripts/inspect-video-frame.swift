import Foundation
import Vision

struct Box: Codable {
    var x: Double; var y: Double; var width: Double; var height: Double
    init(_ rect: CGRect) { x = rect.minX; y = 1 - rect.maxY; width = rect.width; height = rect.height }
}
struct TextItem: Codable { var text: String; var confidence: Float; var box: Box }
struct Observation: Codable { var text: [TextItem]; var faces: [Box] }

var output: [Observation] = []
for name in CommandLine.arguments.dropFirst() {
    let handler = VNImageRequestHandler(url: URL(fileURLWithPath: name), options: [:])
    let text = VNRecognizeTextRequest(); text.recognitionLevel = .accurate; text.usesLanguageCorrection = false
    let faces = VNDetectFaceRectanglesRequest()
    do { try handler.perform([text, faces]) }
    catch { output.append(Observation(text: [], faces: [])); continue }
    let lines = (text.results ?? []).compactMap { item -> TextItem? in
        guard let value = item.topCandidates(1).first else { return nil }
        return TextItem(text: value.string, confidence: value.confidence, box: Box(item.boundingBox))
    }
    output.append(Observation(text: lines, faces: (faces.results ?? []).map { Box($0.boundingBox) }))
}
FileHandle.standardOutput.write(try JSONEncoder().encode(output))
