import Foundation

// MARK: - Lookups (contract 2.1)

extension ExprChecker {
    /// `record[key]` (contract 2.1): the field an enum key names. The
    /// enum's members and the record's fields must be the same set, which
    /// is what makes the lookup total and its coverage exhaustive, and
    /// every field must share one type, which is the lookup's.
    func lookupType(_ base: Expr, _ key: Expr) throws -> MilanoType {
        try gateFeature("[]")
        guard let subject = try infer(base), case .record(let fields) = subject.kind,
            !subject.optional
        else {
            throw ExprError(detail: "a lookup reads a non-optional record")
        }
        guard let keyType = try infer(key), case .enumeration(let members) = keyType.kind,
            !keyType.optional
        else {
            throw ExprError(detail: "a lookup's key is a non-optional enum")
        }
        guard members == Set(fields.keys) else {
            throw ExprError(detail: "a lookup's enum members and the record's fields must match")
        }
        guard let first = fields[fields.keys.sorted()[0]],
            fields.values.allSatisfy({ $0 == first })
        else {
            throw ExprError(detail: "a lookup's record fields must share one type")
        }
        return first
    }
}
