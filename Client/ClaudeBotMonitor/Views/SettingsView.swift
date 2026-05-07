import SwiftUI

struct SettingsView: View {
    @Bindable var viewModel: SettingsViewModel

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Service & Status - side by side
                    HStack(alignment: .top, spacing: 16) {
                        // Service (left)
                        GroupBox("Service") {
                            VStack(alignment: .leading, spacing: 8) {
                                LabeledContent("Project") {
                                    Text(viewModel.projectPath)
                                        .font(.system(size: 10, design: .monospaced))
                                        .foregroundColor(.secondary)
                                        .lineLimit(1)
                                        .truncationMode(.middle)
                                }

                                Toggle("Start on login", isOn: Binding(
                                    get: { viewModel.isInLoginItems },
                                    set: { viewModel.toggleLoginItems($0) }
                                ))
                                .font(.system(size: 12))

                                Spacer(minLength: 0)

                                HStack(spacing: 6) {
                                    Button("Reinstall") {
                                        viewModel.reinstallService()
                                    }
                                    .buttonStyle(.bordered)
                                    .controlSize(.small)

                                    Button("Uninstall") {
                                        viewModel.uninstallService()
                                    }
                                    .buttonStyle(.bordered)
                                    .controlSize(.small)
                                    .foregroundColor(.red)

                                    Spacer()

                                    Button("Open Project") {
                                        viewModel.openProject()
                                    }
                                    .buttonStyle(.bordered)
                                    .controlSize(.small)
                                }
                            }
                            .padding(.vertical, 4)
                            .frame(maxHeight: .infinity)
                        }
                        .frame(minWidth: 300)

                        // Integrations (middle)
                        GroupBox("Integrations") {
                            VStack(alignment: .leading, spacing: 6) {
                                // Google section
                                HStack {
                                    Image(systemName: "g.circle.fill")
                                        .foregroundColor(.blue)
                                    Text("Google")
                                        .font(.system(size: 10, weight: .medium))
                                    Spacer()
                                    Button("Login") {
                                        viewModel.runGoogleAuthSetup()
                                    }
                                    .buttonStyle(.bordered)
                                    .controlSize(.mini)
                                }

                                // Atlassian section
                                HStack {
                                    Image(systemName: "a.circle.fill")
                                        .foregroundColor(.blue)
                                    Text("Atlassian")
                                        .font(.system(size: 10, weight: .medium))
                                    Spacer()
                                    Button("Login") {
                                        viewModel.runAtlassianAuthSetup()
                                    }
                                    .buttonStyle(.bordered)
                                    .controlSize(.mini)
                                }

                                Spacer(minLength: 0)

                                Divider()

                                HStack(spacing: 6) {
                                    Button("Setup") {
                                        viewModel.runGoogleSkillsSetup()
                                    }
                                    .buttonStyle(.bordered)
                                    .controlSize(.small)

                                    Spacer()

                                    Button("Data") {
                                        viewModel.openGoogleDataFolder()
                                    }
                                    .buttonStyle(.bordered)
                                    .controlSize(.small)
                                }
                            }
                            .padding(.vertical, 4)
                            .frame(maxHeight: .infinity)
                        }
                        .frame(minWidth: 200)

                        // Status (right)
                        GroupBox("Status") {
                            VStack(alignment: .leading, spacing: 6) {
                                StatusRowCompact(label: "Version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0")
                                StatusRowCompact(label: "Node", value: viewModel.getNodeVersion())
                                StatusRowCompact(label: "Log File", value: BotService.logPath)

                                Spacer(minLength: 0)

                                Divider()

                                HStack(spacing: 6) {
                                    Button("Logs") {
                                        viewModel.openLogsFolder()
                                    }
                                    .buttonStyle(.bordered)
                                    .controlSize(.small)

                                    Button("Terminal") {
                                        viewModel.openTerminal()
                                    }
                                    .buttonStyle(.bordered)
                                    .controlSize(.small)
                                }
                            }
                            .padding(.vertical, 4)
                            .frame(maxHeight: .infinity)
                        }
                        .frame(minWidth: 180)
                    }
                    .fixedSize(horizontal: false, vertical: true)

                    // Environment variables by section
                    ForEach(viewModel.sections, id: \.self) { section in
                        GroupBox(section) {
                            VStack(spacing: 12) {
                                ForEach(viewModel.variables(in: section)) { variable in
                                    EnvVariableRow(variable: variable, viewModel: viewModel)
                                }
                            }
                            .padding(.vertical, 4)
                        }
                    }
                }
                .padding()
            }

            Divider()

            // Footer
            HStack {
                if viewModel.hasChanges {
                    Label("Unsaved changes", systemImage: "exclamationmark.circle.fill")
                        .font(.caption)
                        .foregroundColor(.orange)
                }

                Spacer()

                Button("Reload") {
                    viewModel.reload()
                }

                Button("Save & Restart") {
                    viewModel.saveAndRestart()
                }
                .buttonStyle(.borderedProminent)
                .disabled(!viewModel.hasChanges)
            }
            .padding(12)
            .background(Color(NSColor.windowBackgroundColor))
        }
        .alert("Settings Saved", isPresented: $viewModel.showSaveAlert) {
            Button("OK", role: .cancel) { }
        } message: {
            Text("Configuration saved. The bot is restarting...")
        }
    }
}

struct StatusRowCompact: View {
    let label: String
    let value: String

    var body: some View {
        HStack {
            Text(label)
                .font(.system(size: 10, weight: .medium))
                .foregroundColor(.secondary)
            Spacer()
            Text(value)
                .font(.system(size: 10, design: .monospaced))
                .foregroundColor(.primary)
                .lineLimit(1)
                .truncationMode(.middle)
        }
    }
}

struct EnvVariableRow: View {
    let variable: EnvVariable
    @Bindable var viewModel: SettingsViewModel
    @State private var value: String = ""
    @State private var showPassword = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(variable.key)
                    .font(.system(size: 12, design: .monospaced))
                    .fontWeight(.medium)
                if variable.value.isEmpty {
                    Text("(not set)")
                        .font(.caption)
                        .foregroundColor(.orange)
                }
                Spacer()
            }

            if !variable.comment.isEmpty {
                Text(variable.comment)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            HStack {
                if variable.isSecret && !showPassword {
                    SecureField(variable.placeholder, text: $value)
                        .textFieldStyle(.roundedBorder)
                        .onChange(of: value) { _, newValue in
                            viewModel.updateValue(for: variable.key, value: newValue)
                        }
                } else {
                    TextField(variable.placeholder, text: $value)
                        .textFieldStyle(.roundedBorder)
                        .onChange(of: value) { _, newValue in
                            viewModel.updateValue(for: variable.key, value: newValue)
                        }
                }

                if variable.isSecret {
                    Button(action: { showPassword.toggle() }) {
                        Image(systemName: showPassword ? "eye.slash" : "eye")
                    }
                    .buttonStyle(.borderless)
                }
            }
        }
        .onAppear {
            value = variable.value
        }
    }
}
