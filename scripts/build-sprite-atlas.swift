import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

private let frameCount = 8
private let alphaThreshold: UInt8 = 24

struct Bounds {
    var minX = Int.max
    var minY = Int.max
    var maxX = Int.min
    var maxY = Int.min

    var isEmpty: Bool { minX > maxX || minY > maxY }
    var width: Int { isEmpty ? 0 : maxX - minX + 1 }
    var height: Int { isEmpty ? 0 : maxY - minY + 1 }

    mutating func include(x: Int, y: Int) {
        minX = min(minX, x)
        minY = min(minY, y)
        maxX = max(maxX, x)
        maxY = max(maxY, y)
    }
}

func largestOpaqueComponent(
    pixels: [UInt8],
    width: Int,
    height: Int,
    bytesPerRow: Int,
    startX: Int,
    endX: Int
) -> Bounds {
    let cellWidth = endX - startX
    var visited = [Bool](repeating: false, count: cellWidth * height)
    var bestBounds = Bounds()
    var bestCount = 0

    for y in 0..<height {
        for localX in 0..<cellWidth {
            let visitIndex = y * cellWidth + localX
            let x = startX + localX
            if visited[visitIndex] || pixels[y * bytesPerRow + x * 4 + 3] <= alphaThreshold {
                continue
            }

            var queue = [visitIndex]
            var cursor = 0
            var component = Bounds()
            var count = 0
            visited[visitIndex] = true

            while cursor < queue.count {
                let current = queue[cursor]
                cursor += 1
                let currentY = current / cellWidth
                let currentLocalX = current % cellWidth
                component.include(x: startX + currentLocalX, y: currentY)
                count += 1

                for deltaY in -1...1 {
                    for deltaX in -1...1 where deltaX != 0 || deltaY != 0 {
                        let nextX = currentLocalX + deltaX
                        let nextY = currentY + deltaY
                        guard nextX >= 0, nextX < cellWidth, nextY >= 0, nextY < height else { continue }
                        let next = nextY * cellWidth + nextX
                        let globalX = startX + nextX
                        guard
                            !visited[next],
                            pixels[nextY * bytesPerRow + globalX * 4 + 3] > alphaThreshold
                        else { continue }
                        visited[next] = true
                        queue.append(next)
                    }
                }
            }

            if count > bestCount {
                bestCount = count
                bestBounds = component
            }
        }
    }

    return bestBounds
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("sprite-atlas: \(message)\n".utf8))
    exit(1)
}

guard (3...4).contains(CommandLine.arguments.count) else {
    fail("usage: swift scripts/build-sprite-atlas.swift INPUT.png OUTPUT.png [FRAME_SIZE]")
}

let inputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
let frameSize = CommandLine.arguments.count == 4 ? Int(CommandLine.arguments[3]) ?? 0 : 32
guard frameSize >= 16 else {
    fail("FRAME_SIZE must be at least 16")
}
let inset = max(2, frameSize / 16)

guard
    let source = CGImageSourceCreateWithURL(inputURL as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
else {
    fail("could not decode \(inputURL.path)")
}

let width = image.width
let height = image.height
let colorSpace = CGColorSpaceCreateDeviceRGB()
let bytesPerRow = width * 4
var pixels = [UInt8](repeating: 0, count: height * bytesPerRow)

guard let readContext = CGContext(
    data: &pixels,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: bytesPerRow,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else {
    fail("could not create read context")
}
readContext.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))

var bounds = [Bounds](repeating: Bounds(), count: frameCount)
for frame in 0..<frameCount {
    let startX = frame * width / frameCount
    let endX = (frame + 1) * width / frameCount
    bounds[frame] = largestOpaqueComponent(
        pixels: pixels,
        width: width,
        height: height,
        bytesPerRow: bytesPerRow,
        startX: startX,
        endX: endX
    )
    if bounds[frame].isEmpty {
        fail("frame \(frame) contains no visible pixels")
    }
}

let maxWidth = bounds.map(\.width).max() ?? 1
let maxHeight = bounds.map(\.height).max() ?? 1
let available = frameSize - inset * 2
let scale = min(Double(available) / Double(maxWidth), Double(available) / Double(maxHeight))
let outputWidth = frameSize * frameCount
let outputHeight = frameSize
let outputBytesPerRow = outputWidth * 4
var outputPixels = [UInt8](repeating: 0, count: outputHeight * outputBytesPerRow)

guard let outputContext = CGContext(
    data: &outputPixels,
    width: outputWidth,
    height: outputHeight,
    bitsPerComponent: 8,
    bytesPerRow: outputBytesPerRow,
    space: colorSpace,
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
) else {
    fail("could not create output context")
}

outputContext.interpolationQuality = .none
outputContext.setShouldAntialias(false)
outputContext.clear(CGRect(x: 0, y: 0, width: outputWidth, height: outputHeight))

for frame in 0..<frameCount {
    let box = bounds[frame]
    let cropRect = CGRect(x: box.minX, y: box.minY, width: box.width, height: box.height)
    guard let crop = image.cropping(to: cropRect) else {
        fail("could not crop frame \(frame)")
    }

    let drawWidth = max(1, Int((Double(box.width) * scale).rounded()))
    let drawHeight = max(1, Int((Double(box.height) * scale).rounded()))
    let drawX = frame * frameSize + (frameSize - drawWidth) / 2
    let drawY = inset
    outputContext.draw(crop, in: CGRect(x: drawX, y: drawY, width: drawWidth, height: drawHeight))
}

guard
    let outputImage = outputContext.makeImage(),
    let destination = CGImageDestinationCreateWithURL(
        outputURL as CFURL,
        UTType.png.identifier as CFString,
        1,
        nil
    )
else {
    fail("could not prepare \(outputURL.path)")
}

CGImageDestinationAddImage(destination, outputImage, nil)
guard CGImageDestinationFinalize(destination) else {
    fail("could not write \(outputURL.path)")
}

print("wrote \(outputURL.path) (\(outputWidth)x\(outputHeight), source \(width)x\(height))")
