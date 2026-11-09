/// Argon2id version 1.3 (RFC 9106), matching libsodium and hash-wasm.
enum Argon2id {
    private static let blockWords = 128
    private static let syncPoints = 4

    /// - Parameters:
    ///   - memoryKiB: memory cost in KiB (1 block = 1 KiB).
    static func hash(
        password: [UInt8], salt: [UInt8], iterations: Int, memoryKiB: Int, parallelism: Int = 1,
        outputLength: Int = 32, secret: [UInt8] = [], associatedData: [UInt8] = []
    ) -> [UInt8] {
        precondition(iterations >= 1 && parallelism >= 1 && memoryKiB >= 8 * parallelism)
        let lanes = parallelism
        let blockCount = 4 * lanes * (memoryKiB / (4 * lanes))
        let laneLength = blockCount / lanes
        let segmentLength = laneLength / syncPoints

        var h0Input = [UInt8]()
        for v in [lanes, outputLength, memoryKiB, iterations, 0x13, 2] { h0Input += le32(v) }
        for part in [password, salt, secret, associatedData] { h0Input += le32(part.count) + part }
        let h0 = Blake2b.hash(h0Input, outputLength: 64)

        var memory = [UInt64](repeating: 0, count: blockCount * blockWords)
        memory.withUnsafeMutableBufferPointer { mem in
            for lane in 0..<lanes {
                for i in 0..<2 {
                    let bytes = variableHash(h0 + le32(i) + le32(lane), length: 1024)
                    let base = (lane * laneLength + i) * blockWords
                    for w in 0..<blockWords { mem[base + w] = loadLE64(bytes, w * 8) }
                }
            }

            var scratch = [UInt64](repeating: 0, count: blockWords * 4)
            scratch.withUnsafeMutableBufferPointer { s in
                for pass in 0..<iterations {
                    for slice in 0..<syncPoints {
                        for lane in 0..<lanes {
                            fillSegment(
                                mem: mem, scratch: s, pass: pass, slice: slice, lane: lane, lanes: lanes,
                                laneLength: laneLength, segmentLength: segmentLength, blockCount: blockCount, iterations: iterations
                            )
                        }
                    }
                }
            }
        }

        var final = [UInt64](repeating: 0, count: blockWords)
        for lane in 0..<lanes {
            let base = (lane * laneLength + laneLength - 1) * blockWords
            for w in 0..<blockWords { final[w] ^= memory[base + w] }
        }
        var finalBytes = [UInt8]()
        finalBytes.reserveCapacity(1024)
        for w in final { finalBytes += le64(w) }
        for i in memory.indices { memory[i] = 0 }
        return variableHash(finalBytes, length: outputLength)
    }

    // swiftlint:disable:next function_parameter_count
    private static func fillSegment(
        mem: UnsafeMutableBufferPointer<UInt64>, scratch: UnsafeMutableBufferPointer<UInt64>,
        pass: Int, slice: Int, lane: Int, lanes: Int, laneLength: Int, segmentLength: Int, blockCount: Int, iterations: Int
    ) {
        let dataIndependent = pass == 0 && slice < 2
        // scratch layout: [0..<128] address block, [128..<256] input block, [256..<384] zero block, [384..<512] temp
        let address = UnsafeMutableBufferPointer(rebasing: scratch[0..<128])
        let input = UnsafeMutableBufferPointer(rebasing: scratch[128..<256])
        let zero = UnsafeMutableBufferPointer(rebasing: scratch[256..<384])
        let temp = UnsafeMutableBufferPointer(rebasing: scratch[384..<512])

        func nextAddresses() {
            input[6] &+= 1
            for i in 0..<128 { zero[i] = 0 }
            compress(x: zero, y: input, into: temp, xorExisting: false)
            for i in 0..<128 { zero[i] = 0 }
            compress(x: zero, y: temp, into: address, xorExisting: false)
        }

        if dataIndependent {
            for i in 0..<128 { input[i] = 0 }
            input[0] = UInt64(pass)
            input[1] = UInt64(lane)
            input[2] = UInt64(slice)
            input[3] = UInt64(blockCount)
            input[4] = UInt64(iterations)
            input[5] = 2
        }

        var startIndex = 0
        if pass == 0 && slice == 0 {
            startIndex = 2
            if dataIndependent { nextAddresses() }
        }

        var current = lane * laneLength + slice * segmentLength + startIndex
        var previous = current % laneLength == 0 ? current + laneLength - 1 : current - 1

        for index in startIndex..<segmentLength {
            if current % laneLength == 1 { previous = current - 1 }
            let pseudoRandom: UInt64
            if dataIndependent {
                if index % 128 == 0 { nextAddresses() }
                pseudoRandom = address[index % 128]
            } else {
                pseudoRandom = mem[previous * blockWords]
            }

            var refLane = Int((pseudoRandom >> 32) % UInt64(lanes))
            if pass == 0 && slice == 0 { refLane = lane }
            let sameLane = refLane == lane

            let areaSize: Int
            if pass == 0 {
                if slice == 0 {
                    areaSize = index - 1
                } else if sameLane {
                    areaSize = slice * segmentLength + index - 1
                } else {
                    areaSize = slice * segmentLength + (index == 0 ? -1 : 0)
                }
            } else {
                areaSize = sameLane ? laneLength - segmentLength + index - 1 : laneLength - segmentLength + (index == 0 ? -1 : 0)
            }
            var relative = pseudoRandom & 0xffff_ffff
            relative = (relative &* relative) >> 32
            relative = UInt64(areaSize - 1) - ((UInt64(areaSize) &* relative) >> 32)
            let startPosition = pass != 0 ? (slice == syncPoints - 1 ? 0 : (slice + 1) * segmentLength) : 0
            let refIndex = (startPosition + Int(relative)) % laneLength
            let ref = refLane * laneLength + refIndex

            let prevBlock = UnsafeMutableBufferPointer(rebasing: mem[(previous * blockWords)..<((previous + 1) * blockWords)])
            let refBlock = UnsafeMutableBufferPointer(rebasing: mem[(ref * blockWords)..<((ref + 1) * blockWords)])
            let outBlock = UnsafeMutableBufferPointer(rebasing: mem[(current * blockWords)..<((current + 1) * blockWords)])
            compress(x: prevBlock, y: refBlock, into: outBlock, xorExisting: pass != 0)

            previous = current
            current += 1
        }
    }

    /// G(X, Y): out = P(X ^ Y) ^ X ^ Y, optionally also XORed with out's old contents (passes after the first).
    @inline(__always)
    private static func compress(
        x: UnsafeMutableBufferPointer<UInt64>, y: UnsafeMutableBufferPointer<UInt64>,
        into out: UnsafeMutableBufferPointer<UInt64>, xorExisting: Bool
    ) {
        withUnsafeTemporaryAllocation(of: UInt64.self, capacity: 256) { tmp in
            let r = UnsafeMutableBufferPointer(rebasing: tmp[0..<128])
            let z = UnsafeMutableBufferPointer(rebasing: tmp[128..<256])
            for i in 0..<128 { r[i] = x[i] ^ y[i]; z[i] = r[i] }
            for row in 0..<8 {
                let b = row * 16
                permute(z, b, b + 1, b + 2, b + 3, b + 4, b + 5, b + 6, b + 7,
                        b + 8, b + 9, b + 10, b + 11, b + 12, b + 13, b + 14, b + 15)
            }
            for col in 0..<8 {
                let b = col * 2
                permute(z, b, b + 1, b + 16, b + 17, b + 32, b + 33, b + 48, b + 49,
                        b + 64, b + 65, b + 80, b + 81, b + 96, b + 97, b + 112, b + 113)
            }
            if xorExisting {
                for i in 0..<128 { out[i] ^= z[i] ^ r[i] }
            } else {
                for i in 0..<128 { out[i] = z[i] ^ r[i] }
            }
        }
    }

    @inline(__always)
    // swiftlint:disable:next function_parameter_count
    private static func permute(
        _ v: UnsafeMutableBufferPointer<UInt64>,
        _ i0: Int, _ i1: Int, _ i2: Int, _ i3: Int, _ i4: Int, _ i5: Int, _ i6: Int, _ i7: Int,
        _ i8: Int, _ i9: Int, _ i10: Int, _ i11: Int, _ i12: Int, _ i13: Int, _ i14: Int, _ i15: Int
    ) {
        gb(v, i0, i4, i8, i12); gb(v, i1, i5, i9, i13); gb(v, i2, i6, i10, i14); gb(v, i3, i7, i11, i15)
        gb(v, i0, i5, i10, i15); gb(v, i1, i6, i11, i12); gb(v, i2, i7, i8, i13); gb(v, i3, i4, i9, i14)
    }

    @inline(__always)
    private static func gb(_ v: UnsafeMutableBufferPointer<UInt64>, _ a: Int, _ b: Int, _ c: Int, _ d: Int) {
        @inline(__always) func fBlaMka(_ x: UInt64, _ y: UInt64) -> UInt64 {
            x &+ y &+ 2 &* (x & 0xffff_ffff) &* (y & 0xffff_ffff)
        }
        v[a] = fBlaMka(v[a], v[b]); v[d] = (v[d] ^ v[a]).rotatedRight(32)
        v[c] = fBlaMka(v[c], v[d]); v[b] = (v[b] ^ v[c]).rotatedRight(24)
        v[a] = fBlaMka(v[a], v[b]); v[d] = (v[d] ^ v[a]).rotatedRight(16)
        v[c] = fBlaMka(v[c], v[d]); v[b] = (v[b] ^ v[c]).rotatedRight(63)
    }

    /// H' from RFC 9106 section 3.3.
    private static func variableHash(_ input: [UInt8], length: Int) -> [UInt8] {
        if length <= 64 { return Blake2b.hash(le32(length) + input, outputLength: length) }
        let r = (length + 31) / 32 - 2
        var v = Blake2b.hash(le32(length) + input, outputLength: 64)
        var out = Array(v.prefix(32))
        for _ in 1..<r {
            v = Blake2b.hash(v, outputLength: 64)
            out += v.prefix(32)
        }
        out += Blake2b.hash(v, outputLength: length - 32 * r)
        return out
    }

    private static func le32(_ v: Int) -> [UInt8] { (0..<4).map { UInt8(truncatingIfNeeded: UInt32(v) >> UInt32($0 * 8)) } }
    private static func le64(_ v: UInt64) -> [UInt8] { (0..<8).map { UInt8(truncatingIfNeeded: v >> UInt64($0 * 8)) } }
    private static func loadLE64(_ b: [UInt8], _ o: Int) -> UInt64 {
        var w: UInt64 = 0
        for j in 0..<8 { w |= UInt64(b[o + j]) << UInt64(8 * j) }
        return w
    }
}
