import SwiftUI

struct SetupView: View {
    @Bindable var viewModel: SetupViewModel

    var body: some View {
        ScrollView {
            VStack(spacing: DesignTokens.spacingXL) {
                // Header
                VStack(spacing: DesignTokens.spacingSM) {
                    Image(systemName: "cpu")
                        .font(.system(size: 48, weight: .light))
                        .foregroundStyle(.tint)

                    Text("Setup Claude Slack Bot")
                        .font(.system(size: 24, weight: .semibold))

                    Text("Configure the bot service to run in the background")
                        .font(.system(size: DesignTokens.fontLG))
                        .foregroundStyle(.secondary)
                }
                .padding(.top, DesignTokens.spacingXL)

                // Setup steps
                VStack(spacing: DesignTokens.spacingLG) {
                    // Step 1: Project Location
                    SetupStepCard(
                        step: 1,
                        title: "Project Location",
                        icon: "folder.fill",
                        description: "Select the claude-slack-bot project folder"
                    ) {
                        VStack(alignment: .leading, spacing: DesignTokens.spacingSM) {
                            HStack(spacing: DesignTokens.spacingSM) {
                                TextField("Project path", text: $viewModel.projectPath)
                                    .textFieldStyle(.plain)
                                    .font(.system(size: DesignTokens.fontSM, design: .monospaced))
                                    .padding(.horizontal, DesignTokens.spacingSM)
                                    .padding(.vertical, 8)
                                    .background {
                                        RoundedRectangle(cornerRadius: DesignTokens.radiusSM)
                                            .fill(Color.surfaceTertiary)
                                    }
                                    .overlay {
                                        RoundedRectangle(cornerRadius: DesignTokens.radiusSM)
                                            .stroke(Color.borderSecondary, lineWidth: 0.5)
                                    }

                                ActionButton("Browse", icon: "folder", style: .secondary) {
                                    viewModel.browseForProject()
                                }
                            }

                            if let error = viewModel.setupError {
                                HStack(spacing: DesignTokens.spacingXS) {
                                    Image(systemName: "exclamationmark.triangle.fill")
                                        .font(.system(size: DesignTokens.iconSM))
                                        .foregroundStyle(Color.accentError)
                                    Text(error)
                                        .font(.system(size: DesignTokens.fontXS))
                                        .foregroundStyle(Color.accentError)
                                }
                            }
                        }
                    }

                    // Step 2: Install Service
                    SetupStepCard(
                        step: 2,
                        title: "Background Service",
                        icon: "gearshape.fill",
                        description: "Install the bot as a background service"
                    ) {
                        HStack(spacing: DesignTokens.spacingSM) {
                            if viewModel.isServiceInstalled {
                                HStack(spacing: DesignTokens.spacingXS) {
                                    Image(systemName: "checkmark.circle.fill")
                                        .font(.system(size: DesignTokens.iconLG))
                                        .foregroundStyle(Color.accentSuccess)
                                    Text("Service installed")
                                        .font(.system(size: DesignTokens.fontSM, weight: .medium))
                                        .foregroundStyle(Color.accentSuccess)
                                }
                            } else {
                                HStack(spacing: DesignTokens.spacingXS) {
                                    Image(systemName: "circle.dashed")
                                        .font(.system(size: DesignTokens.iconLG))
                                        .foregroundColor(Color.secondary.opacity(0.6))
                                    Text("Not installed")
                                        .font(.system(size: DesignTokens.fontSM))
                                        .foregroundStyle(.secondary)
                                }
                            }

                            Spacer()
                        }
                    }

                    // Step 3: Login Items
                    SetupStepCard(
                        step: 3,
                        title: "Start on Login",
                        icon: "person.fill",
                        description: "Optional: Launch this monitor app automatically"
                    ) {
                        Toggle(isOn: Binding(
                            get: { viewModel.isInLoginItems },
                            set: { viewModel.toggleLoginItems($0) }
                        )) {
                            Text("Add to Login Items")
                                .font(.system(size: DesignTokens.fontSM))
                        }
                        .toggleStyle(.checkbox)
                    }
                }

                // Complete button
                ActionButton("Complete Setup", icon: "checkmark.circle", style: .primary, disabled: viewModel.isProjectPathEmpty) {
                    _ = viewModel.completeSetup()
                }
                .frame(minWidth: 200)

                Spacer()
            }
            .padding(DesignTokens.spacingXL)
            .frame(maxWidth: 500)
            .frame(maxWidth: .infinity)
        }
    }
}

// MARK: - Setup Step Card

struct SetupStepCard<Content: View>: View {
    let step: Int
    let title: String
    let icon: String
    let description: String
    let content: Content

    init(step: Int, title: String, icon: String, description: String, @ViewBuilder content: () -> Content) {
        self.step = step
        self.title = title
        self.icon = icon
        self.description = description
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingMD) {
            // Header
            HStack(spacing: DesignTokens.spacingMD) {
                // Step number badge
                ZStack {
                    Circle()
                        .fill(Color.accentColor.opacity(0.15))
                        .frame(width: 32, height: 32)

                    Text("\(step)")
                        .font(.system(size: DesignTokens.fontMD, weight: .bold))
                        .foregroundStyle(Color.accentColor)
                }

                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: DesignTokens.spacingXS) {
                        Image(systemName: icon)
                            .font(.system(size: DesignTokens.iconMD))
                            .foregroundStyle(.secondary)

                        Text(title)
                            .font(.system(size: DesignTokens.fontLG, weight: .semibold))
                    }

                    Text(description)
                        .font(.system(size: DesignTokens.fontSM))
                        .foregroundStyle(.secondary)
                }

                Spacer()
            }

            // Content
            content
                .padding(.leading, 44) // Align with header text
        }
        .padding(DesignTokens.spacingLG)
        .background {
            RoundedRectangle(cornerRadius: DesignTokens.radiusMD)
                .fill(Color.surfaceSecondary.opacity(0.5))
        }
        .overlay {
            RoundedRectangle(cornerRadius: DesignTokens.radiusMD)
                .stroke(Color.borderSecondary, lineWidth: 0.5)
        }
    }
}
