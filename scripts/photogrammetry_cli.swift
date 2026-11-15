import Foundation
import RealityKit
import ImageIO
import UniformTypeIdentifiers

@main
struct SkateparkPhotogrammetryCLI {
    static func injectEXIF(inputDir: URL, outputDir: URL, isBabenhausen: Bool, isGoPro: Bool) throws -> Int {
        let fm = FileManager.default
        if fm.fileExists(atPath: outputDir.path) {
            try fm.removeItem(at: outputDir)
        }
        try fm.createDirectory(at: outputDir, withIntermediateDirectories: true)

        let files = try fm.contentsOfDirectory(at: inputDir, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension.lowercased() == "jpg" || $0.pathExtension.lowercased() == "jpeg" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }

        let focal35mm: Double = isBabenhausen ? 13.81 : (isGoPro ? 16.0 : 24.0)
        let focalMm: Double = isBabenhausen ? 3.0 : (isGoPro ? 3.0 : 6.72)
        let fNum: Double = isBabenhausen ? 2.0 : 2.8
        let wPx: Double = isBabenhausen ? 1920.0 : 3840.0
        let hPx: Double = isBabenhausen ? 1920.0 : 2160.0
        let makeStr = isBabenhausen ? "Insta360" : (isGoPro ? "GoPro" : "DJI")
        let modelStr = isBabenhausen ? "Insta360 X4 Rectilinear 105deg" : (isGoPro ? "HERO9 Black" : "DJI Drone 4K")

        var count = 0
        for file in files {
            let name = file.lastPathComponent
            let outURL = outputDir.appendingPathComponent(name)

            let exifDict: [String: Any] = [
                kCGImagePropertyExifFocalLenIn35mmFilm as String: focal35mm,
                kCGImagePropertyExifFocalLength as String: focalMm,
                kCGImagePropertyExifFNumber as String: fNum,
                kCGImagePropertyExifPixelXDimension as String: wPx,
                kCGImagePropertyExifPixelYDimension as String: hPx
            ]
            let tiffDict: [String: Any] = [
                kCGImagePropertyTIFFMake as String: makeStr,
                kCGImagePropertyTIFFModel as String: modelStr
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

        // Syntax: photogrammetry_cli <inputFramesDir> <outputUSDZPath> [detail] [ordering: sequential|unordered] [masking: true|false]
        let inputDirStr = args.count > 1 ? args[1] : "/Users/kargm/Documents/projects/surfskate_game/data/extracted_frames_babenhausen"
        let outputUSDZStr = args.count > 2 ? args[2] : "/Users/kargm/Documents/projects/surfskate_game/data/raw_babenhausen_scan.usdz"
        let detailArg = args.count > 3 ? args[3] : "medium"
        let orderingArg = args.count > 4 ? args[4] : "sequential"
        let maskingArg = args.count > 5 ? args[5] : "false"

        let rawFramesDir = URL(fileURLWithPath: inputDirStr)
        let parentDir = rawFramesDir.deletingLastPathComponent()
        let exifFramesDir = parentDir.appendingPathComponent("frames_exif")
        let outputUSDZ = URL(fileURLWithPath: outputUSDZStr)

        let detail: PhotogrammetrySession.Request.Detail
        switch detailArg.lowercased() {
        case "preview": detail = .preview
        case "reduced": detail = .reduced
        case "medium": detail = .medium
        case "full": detail = .full
        case "raw": detail = .raw
        default: detail = .medium
        }

        print("=== macOS RealityKit Photogrammetry CLI ===")
        print("Supported on this Mac: \(PhotogrammetrySession.isSupported)")
        guard PhotogrammetrySession.isSupported else {
            print("ERROR: PhotogrammetrySession is not supported on this machine.")
            exit(1)
        }

        do {
            let isInsta360 = inputDirStr.lowercased().contains("babenhausen") || inputDirStr.lowercased().contains("bbh") || inputDirStr.lowercased().contains("airport") || inputDirStr.lowercased().contains("insta360")
            let isGoPro = inputDirStr.lowercased().contains("aschheim") || inputDirStr.lowercased().contains("gopro")
            let cameraLabel = isInsta360 ? "Insta360 105deg (13.81mm equiv, 1920x1920)" : (isGoPro ? "GoPro HERO9 16mm" : "DJI 24mm")

            print("1. Injecting camera EXIF intrinsics (\(cameraLabel)) into frames...")
            let frameCount = try injectEXIF(inputDir: rawFramesDir, outputDir: exifFramesDir, isBabenhausen: isInsta360, isGoPro: isGoPro)
            print("   Prepared \(frameCount) frames with EXIF metadata at \(exifFramesDir.path)")

            var config = PhotogrammetrySession.Configuration()
            config.sampleOrdering = (orderingArg.lowercased() == "sequential") ? .sequential : .unordered
            config.featureSensitivity = .high
            config.isObjectMaskingEnabled = (maskingArg.lowercased() == "true")

            print("2. Initializing PhotogrammetrySession (sampleOrdering: \(config.sampleOrdering), featureSensitivity: .high, isObjectMaskingEnabled: \(config.isObjectMaskingEnabled))...")
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
