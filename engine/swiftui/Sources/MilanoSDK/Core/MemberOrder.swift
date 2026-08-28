extension Dictionary where Key == String {
    /// The document model's member order: a JSON object's members in
    /// lexicographic key order (document model spec, Validation). JSON
    /// defines no order for them and this runtime's parser keeps none, so
    /// every walk that can report, resolve, or reject sorts here.
    var byKey: [(key: String, value: Value)] {
        sorted { $0.key < $1.key }
    }
}
