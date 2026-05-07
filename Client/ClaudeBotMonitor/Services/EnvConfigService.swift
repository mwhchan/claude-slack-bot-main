import Foundation
import Factory

protocol EnvConfigServiceProtocol {
    var variables: [EnvVariable] { get }
    var hasChanges: Bool { get }
    var sections: [String] { get }

    func loadConfig()
    func saveConfig()
    func updateValue(for key: String, value: String)
    func variables(in section: String) -> [EnvVariable]
}

@Observable
final class EnvConfigService: EnvConfigServiceProtocol {
    @ObservationIgnored
    @Injected(\.setupManager) private var setupManager

    private(set) var variables: [EnvVariable] = []
    private(set) var hasChanges: Bool = false

    private var envPath: String { "\(setupManager.projectPath)/.env" }

    init() {
        loadConfig()
    }

    func loadConfig() {
        guard !setupManager.projectPath.isEmpty else { return }
        guard let example = try? String(contentsOfFile: envPath, encoding: .utf8) else { return }

        var existing: [String: String] = [:]
        if let env = try? String(contentsOfFile: envPath, encoding: .utf8) {
            for line in env.components(separatedBy: .newlines) {
                let t = line.trimmingCharacters(in: .whitespaces)
                if !t.hasPrefix("#") && t.contains("=") {
                    let p = t.split(separator: "=", maxSplits: 1)
                    if p.count >= 1 { existing[String(p[0])] = p.count > 1 ? String(p[1]) : "" }
                }
            }
        }

        var section = "General"
        var comment = ""
        var vars: [EnvVariable] = []

        for line in example.components(separatedBy: .newlines) {
            let t = line.trimmingCharacters(in: .whitespaces)
            if t.hasPrefix("# ===") || t.hasPrefix("#===") {
                section = t.replacingOccurrences(of: "#", with: "").replacingOccurrences(of: "=", with: "").trimmingCharacters(in: .whitespaces).capitalized
                comment = ""
            } else if t.hasPrefix("#") && !t.contains("=") {
                comment = t.replacingOccurrences(of: "#", with: "").trimmingCharacters(in: .whitespaces)
            } else if t.contains("=") && !t.hasPrefix("#") {
                let p = t.split(separator: "=", maxSplits: 1)
                if p.count >= 1 {
                    let key = String(p[0])
                    let placeholder = p.count > 1 ? String(p[1]) : ""
                    let isSecret = key.lowercased().contains("token") || key.lowercased().contains("secret")
                    vars.append(EnvVariable(key: key, comment: comment, section: section, value: existing[key] ?? "", placeholder: placeholder, isSecret: isSecret))
                    comment = ""
                }
            }
        }
        variables = vars
        hasChanges = false
    }

    func saveConfig() {
        var content = "# Claude Slack Bot Configuration\n\n"
        var currentSection = ""
        for v in variables {
            if v.section != currentSection {
                currentSection = v.section
                content += "\n# \(currentSection.uppercased())\n"
            }
            if !v.comment.isEmpty { content += "# \(v.comment)\n" }
            content += "\(v.key)=\(v.value)\n"
        }
        try? content.write(toFile: envPath, atomically: true, encoding: .utf8)
        hasChanges = false
    }

    func updateValue(for key: String, value: String) {
        if let i = variables.firstIndex(where: { $0.key == key }) {
            variables[i].value = value
            hasChanges = true
        }
    }

    var sections: [String] {
        var seen = Set<String>()
        return variables.compactMap { seen.insert($0.section).inserted ? $0.section : nil }
    }

    func variables(in section: String) -> [EnvVariable] {
        variables.filter { $0.section == section }
    }
}
