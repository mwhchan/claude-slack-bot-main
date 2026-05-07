import Foundation

struct EnvVariable: Identifiable {
    let id = UUID()
    let key: String
    let comment: String
    let section: String
    var value: String
    let placeholder: String
    let isSecret: Bool
}
