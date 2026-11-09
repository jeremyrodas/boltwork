import BoltworkKit

extension AppModel {
    /// Looks up passwords not yet checked in Have I Been Pwned (k-anonymity) and records their counts.
    /// Stops at the first failure, such as being offline.
    func lookUpBreaches() async {
        let known = pwnedCounts
        let hashes = Set(items.filter { $0.state == .active }.compactMap { $0.content.field(for: .password)?.value }.map(Watchtower.sha1Hex))
        for hash in hashes where known[hash] == nil {
            guard !Task.isCancelled, let count = try? await Watchtower.pwnedCount(sha1: hash) else { break }
            recordPwned(sha1: hash, count: count)
        }
    }
}
