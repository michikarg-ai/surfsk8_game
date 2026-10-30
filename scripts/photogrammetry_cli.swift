import Foundation
import RealityKit
import ImageIO
import UniformTypeIdentifiers

@main
struct SkateparkPhotogrammetryCLI {
    static func injectEXIF(inputDir: URL, outputDir: URL) throws -> Int {
        let fm = FileManager.default
        if fm.fileExists(atPath: outputDir.path) {
            try fm.removeItem(at: outputDir)
        }
        try fm.createDirectory(at: outputDir, withIntermediateDirectories: true)

        let files = try fm.contentsOfDirectory(at: inputDir, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension.lowercased() == "jpg" || $0.pathExtension.lowercased() == "jpeg" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }

        var count = 0
        for file in files {
            let name = file.lastPathComponent
            let isGoPro = name.contains("gopro")
            let outURL = outputDir.appendingPathComponent(name)

            let exifDict: [String: Any] = [
                kCGImagePropertyExifFocalLenIn35mmFilm as String: isGoPro ? 16 : 24,
                kCGImagePropertyExifFocalLength as String: isGoPro ? 3.0 : 6.72,
                kCGImagePropertyExifFNumber as String: 2.8,
                kCGImagePropertyExifPixelXDimension as String: isGoPro ? 2160 : 3840,
                kCGImagePropertyExifPixelYDimension as String: isGoPro ? 3840 : 2160
            ]
            let tiffDict: [String: Any] = [
                kCGImagePropertyTIFFMake as String: isGoPro ? "GoPro" : "DJI",
                kCGImagePropertyTIFFModel as String: isGoPro ? "HERO11 Black" : "DJI Drone 4K"
            ]
            let metaProps: [String: Any] = [
                kCGImagePropertyExifDictionary as String: exifDict,
                kCGImagePropertyTIFFDictionary as String: tiffDict
            ]

            guard let src = CGImageSourceCreateWithURL(file as CFURL, nil),
                  let uti = CGImageSourceGetType(src),
                  let dest = CGImageDestinationCreateWithURL(outURL as CFURL, uti, 1, nil) else {
                continue
            }
            var err: Unmanaged<CFError>?
            if CGImageDestinationCopyImageSource(dest, src, metaProps as CFDictionary, &err) {
                count += 1
            } else {
                try fm.copyItem(at: file, to: outURL)
                count += 1
            }
        }
        return count
    }

    static func main() async {
        let args = CommandLine.arguments
        let detailArg = args.count > 1 ? args[1] : "medium"
        let modeArg = args.count > 2 ? args[2] : "multi"

        let baseDir = URL(fileURLWithPath: "/Users/kargm/Documents/projects/surfskate_game/video")
        let isMulti = (modeArg.lowercased() == "multi")
        let rawFramesDir = baseDir.appendingPathComponent(isMulti ? "frames_multi_raw" : "frames")
        let exifFramesDir = baseDir.appendingPathComponent(isMulti ? "frames_multi_exif" : "frames_exif")
        let outputUSDZ = baseDir.appendingPathComponent(isMulti ? "skatepark_multi.usdz" : "skatepark.usdz")

        let detail: PhotogrammetrySession.Request.Detail
        switch detailArg.lowercased() {
        case "preview": detail = .preview
        case "reduced": detail = .reduced
        case "medium": detail = .medium
        case "full": detail = .full
        case "raw": detail = .raw
        default: detail = .medium
        }

        print("=== macOS RealityKit Object Capture CLI (\(isMulti ? "MULTI-VIDEO" : "SINGLE-VIDEO")) ===")
        print("Supported on this Mac: \(PhotogrammetrySession.isSupported)")
        guard PhotogrammetrySession.isSupported else {
            print("ERROR: PhotogrammetrySession is not supported on this machine.")
            exit(1)
        }

        do {
            print("1. Injecting camera EXIF intrinsics into \(rawFramesDir.lastPathComponent)...")
            let frameCount = try injectEXIF(inputDir: rawFramesDir, outputDir: exifFramesDir)
            print("   Prepared \(frameCount) frames with EXIF metadata at \(exifFramesDir.path)")

            var config = PhotogrammetrySession.Configuration()
            config.sampleOrdering = isMulti ? .unordered : .sequential
            config.featureSensitivity = .high
            config.isObjectMaskingEnabled = false

            print("2. Initializing PhotogrammetrySession (sampleOrdering: \(config.sampleOrdering), featureSensitivity: .high, isObjectMaskingEnabled: false)...")
            let session = try PhotogrammetrySession(input: exifFramesDir, configuration: config)

            if FileManager.default.fileExists(atPath: outputUSDZ.path) {
                try FileManager.default.removeItem(at: outputUSDZ)
            }

            let request = PhotogrammetrySession.Request.modelFile(url: outputUSDZ, detail: detail)
            print("3. Starting reconstruction -> \(outputUSDZ.path) (detail: \(detailArg))...")
            try session.process(requests: [request])

            var lastPercent = -1
            for try await output in session.outputs {
                switch output {
                case .inputComplete:
                    print("   [RealityKit] All \(frameCount) input images ingested.")
                case .requestProgress(_, let fractionComplete):
                    let pct = Int((fractionComplete * 100.0).rounded())
                    if pct != lastPercent && pct % 5 == 0 {
                        lastPercent = pct
                        print("   [RealityKit] Progress: \(pct)%")
                        fflush(stdout)
                    }
                case .requestProgressInfo(_, _):
                    break
                case .requestComplete(_, let result):
                    print("   [RealityKit] Request completed: \(result)")
                case .requestError(_, let error):
                    print("   [RealityKit] Request ERROR: \(error)")
                case .processingComplete:
                    print("   [RealityKit] Processing complete!")
                    return
                case .processingCancelled:
                    print("   [RealityKit] Processing cancelled.")
                    return
                case .invalidSample(let id, let reason):
                    print("   [RealityKit] Invalid sample #\(id): \(reason)")
                case .skippedSample(let id):
                    print("   [RealityKit] Skipped sample #\(id)")
                case .automaticDownsampling:
                    print("   [RealityKit] Automatic downsampling applied.")
                case .stitchingIncomplete:
                    print("   [RealityKit] Warning: Stitching incomplete.")
                @unknown default:
                    break
                }
            }
        } catch {
            print("ERROR: \(error)")
            exit(1)
        }
    }
}
