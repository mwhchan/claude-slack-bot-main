import SwiftUI

// MARK: - Design Tokens

enum DesignTokens {
    // Spacing
    static let spacingXS: CGFloat = 4
    static let spacingSM: CGFloat = 8
    static let spacingMD: CGFloat = 12
    static let spacingLG: CGFloat = 16
    static let spacingXL: CGFloat = 24

    // Corner radius
    static let radiusSM: CGFloat = 4
    static let radiusMD: CGFloat = 8
    static let radiusLG: CGFloat = 12

    // Font sizes
    static let fontXS: CGFloat = 10
    static let fontSM: CGFloat = 11
    static let fontMD: CGFloat = 12
    static let fontLG: CGFloat = 13
    static let fontXL: CGFloat = 14

    // Icon sizes
    static let iconSM: CGFloat = 10
    static let iconMD: CGFloat = 12
    static let iconLG: CGFloat = 14
    static let iconXL: CGFloat = 16
}

// MARK: - Colors

extension Color {
    static let surfacePrimary = Color(NSColor.windowBackgroundColor)
    static let surfaceSecondary = Color(NSColor.controlBackgroundColor)
    static let surfaceTertiary = Color(NSColor.textBackgroundColor)

    static let borderPrimary = Color(NSColor.separatorColor)
    static let borderSecondary = Color(NSColor.separatorColor).opacity(0.5)

    static let textPrimary = Color(NSColor.labelColor)
    static let textSecondary = Color(NSColor.secondaryLabelColor)
    static let textTertiary = Color(NSColor.tertiaryLabelColor)

    static let accentSuccess = Color.green
    static let accentWarning = Color.orange
    static let accentError = Color.red
    static let accentInfo = Color.blue
}

// MARK: - Toolbar View

struct ToolbarView<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        HStack(spacing: DesignTokens.spacingMD) {
            content
        }
        .padding(.horizontal, DesignTokens.spacingLG)
        .padding(.vertical, DesignTokens.spacingSM)
        .frame(height: 38)
        .background(.bar)
    }
}

// MARK: - Section Header

struct SectionHeader: View {
    let title: String
    let icon: String?

    init(_ title: String, icon: String? = nil) {
        self.title = title
        self.icon = icon
    }

    var body: some View {
        HStack(spacing: DesignTokens.spacingSM) {
            if let icon = icon {
                Image(systemName: icon)
                    .font(.system(size: DesignTokens.iconMD, weight: .medium))
                    .foregroundStyle(.secondary)
            }
            Text(title)
                .font(.system(size: DesignTokens.fontSM, weight: .semibold))
                .foregroundStyle(.secondary)
                .textCase(.uppercase)
        }
    }
}

// MARK: - Status Badge

struct StatusBadge: View {
    let isActive: Bool
    let activeText: String
    let inactiveText: String

    init(isActive: Bool, activeText: String = "Active", inactiveText: String = "Inactive") {
        self.isActive = isActive
        self.activeText = activeText
        self.inactiveText = inactiveText
    }

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(isActive ? Color.accentSuccess : Color.textTertiary)
                .frame(width: 8, height: 8)
                .overlay {
                    if isActive {
                        Circle()
                            .fill(Color.accentSuccess)
                            .frame(width: 8, height: 8)
                            .blur(radius: 4)
                    }
                }
            Text(isActive ? activeText : inactiveText)
                .font(.system(size: DesignTokens.fontSM, weight: .medium))
                .foregroundStyle(isActive ? Color.accentSuccess : .secondary)
        }
        .padding(.horizontal, DesignTokens.spacingSM)
        .padding(.vertical, DesignTokens.spacingXS)
        .background(
            RoundedRectangle(cornerRadius: DesignTokens.radiusSM)
                .fill((isActive ? Color.accentSuccess : Color.textTertiary).opacity(0.1))
        )
    }
}

// MARK: - Modern Tab Button

struct ModernTabButton: View {
    let title: String
    let icon: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: DesignTokens.iconMD, weight: isSelected ? .semibold : .regular))
                Text(title)
                    .font(.system(size: DesignTokens.fontMD, weight: isSelected ? .semibold : .regular))
            }
            .foregroundStyle(isSelected ? Color.accentColor : .secondary)
            .padding(.horizontal, DesignTokens.spacingMD)
            .padding(.vertical, DesignTokens.spacingSM)
            .background {
                if isSelected {
                    RoundedRectangle(cornerRadius: DesignTokens.radiusMD)
                        .fill(Color.accentColor.opacity(0.12))
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Icon Button

struct IconButton: View {
    let icon: String
    let label: String?
    var disabled: Bool = false
    var size: IconButtonSize = .medium
    let action: () -> Void

    enum IconButtonSize {
        case small, medium, large

        var iconSize: CGFloat {
            switch self {
            case .small: return DesignTokens.iconSM
            case .medium: return DesignTokens.iconMD
            case .large: return DesignTokens.iconLG
            }
        }

        var padding: CGFloat {
            switch self {
            case .small: return DesignTokens.spacingXS
            case .medium: return DesignTokens.spacingSM
            case .large: return DesignTokens.spacingMD
            }
        }
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: DesignTokens.spacingXS) {
                Image(systemName: icon)
                    .font(.system(size: size.iconSize, weight: .medium))
                if let label = label {
                    Text(label)
                        .font(.system(size: DesignTokens.fontSM, weight: .medium))
                }
            }
            .foregroundColor(disabled ? Color.secondary.opacity(0.4) : Color.secondary)
            .padding(.horizontal, size.padding + 4)
            .padding(.vertical, size.padding)
            .background {
                RoundedRectangle(cornerRadius: DesignTokens.radiusSM)
                    .fill(Color.surfaceSecondary)
            }
            .overlay {
                RoundedRectangle(cornerRadius: DesignTokens.radiusSM)
                    .stroke(Color.borderSecondary, lineWidth: 0.5)
            }
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .help(label ?? icon)
    }
}

// MARK: - Action Button

struct ActionButton: View {
    let title: String
    let icon: String?
    let style: ActionButtonStyle
    let action: () -> Void
    var disabled: Bool = false

    enum ActionButtonStyle {
        case primary, secondary, destructive

        var foregroundColor: Color {
            switch self {
            case .primary: return .white
            case .secondary: return .primary
            case .destructive: return .white
            }
        }

        var backgroundColor: Color {
            switch self {
            case .primary: return .accentColor
            case .secondary: return Color.surfaceSecondary
            case .destructive: return Color.accentError
            }
        }
    }

    init(_ title: String, icon: String? = nil, style: ActionButtonStyle = .secondary, disabled: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.icon = icon
        self.style = style
        self.disabled = disabled
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: DesignTokens.spacingXS) {
                if let icon = icon {
                    Image(systemName: icon)
                        .font(.system(size: DesignTokens.iconSM, weight: .medium))
                }
                Text(title)
                    .font(.system(size: DesignTokens.fontSM, weight: .medium))
            }
            .foregroundColor(disabled ? Color.secondary.opacity(0.5) : style.foregroundColor)
            .padding(.horizontal, DesignTokens.spacingMD)
            .padding(.vertical, 6)
            .background {
                RoundedRectangle(cornerRadius: DesignTokens.radiusSM)
                    .fill(disabled ? Color.surfaceSecondary : style.backgroundColor)
            }
            .overlay {
                if style == .secondary {
                    RoundedRectangle(cornerRadius: DesignTokens.radiusSM)
                        .stroke(Color.borderSecondary, lineWidth: 0.5)
                }
            }
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }
}

// MARK: - Search Field

struct SearchField: View {
    @Binding var text: String
    var placeholder: String = "Search..."

    var body: some View {
        HStack(spacing: DesignTokens.spacingSM) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: DesignTokens.iconMD))
                .foregroundColor(Color.secondary.opacity(0.6))

            TextField(placeholder, text: $text)
                .textFieldStyle(.plain)
                .font(.system(size: DesignTokens.fontMD))

            if !text.isEmpty {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: DesignTokens.iconMD))
                        .foregroundColor(Color.secondary.opacity(0.6))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, DesignTokens.spacingSM)
        .padding(.vertical, 6)
        .background {
            RoundedRectangle(cornerRadius: DesignTokens.radiusSM)
                .fill(Color.surfaceSecondary)
        }
        .overlay {
            RoundedRectangle(cornerRadius: DesignTokens.radiusSM)
                .stroke(Color.borderSecondary, lineWidth: 0.5)
        }
    }
}

// MARK: - Card View

struct CardView<Content: View>: View {
    let title: String?
    let icon: String?
    let content: Content

    init(_ title: String? = nil, icon: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.icon = icon
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DesignTokens.spacingMD) {
            if let title = title {
                HStack(spacing: DesignTokens.spacingSM) {
                    if let icon = icon {
                        Image(systemName: icon)
                            .font(.system(size: DesignTokens.iconMD, weight: .semibold))
                            .foregroundStyle(.secondary)
                    }
                    Text(title)
                        .font(.system(size: DesignTokens.fontLG, weight: .semibold))
                }
            }
            content
        }
        .padding(DesignTokens.spacingLG)
        .frame(maxWidth: .infinity, alignment: .leading)
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

// MARK: - Info Row

struct InfoRow: View {
    let label: String
    let value: String
    var monospace: Bool = false

    var body: some View {
        HStack {
            Text(label)
                .font(.system(size: DesignTokens.fontSM))
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.system(size: DesignTokens.fontSM, design: monospace ? .monospaced : .default))
                .foregroundStyle(.primary)
                .lineLimit(1)
                .truncationMode(.middle)
        }
    }
}

// MARK: - Empty State

struct EmptyStateView: View {
    let icon: String
    let title: String
    let message: String?

    init(icon: String, title: String, message: String? = nil) {
        self.icon = icon
        self.title = title
        self.message = message
    }

    var body: some View {
        VStack(spacing: DesignTokens.spacingMD) {
            Image(systemName: icon)
                .font(.system(size: 44, weight: .light))
                .foregroundStyle(.quaternary)

            Text(title)
                .font(.system(size: DesignTokens.fontLG, weight: .medium))
                .foregroundStyle(.secondary)

            if let message = message {
                Text(message)
                    .font(.system(size: DesignTokens.fontSM))
                    .foregroundColor(Color.secondary.opacity(0.6))
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - Sidebar Row

struct SidebarRow: View {
    let icon: String
    let iconColor: Color
    let title: String
    let subtitle: String?
    let isSelected: Bool
    let action: () -> Void

    init(icon: String, iconColor: Color = .secondary, title: String, subtitle: String? = nil, isSelected: Bool, action: @escaping () -> Void) {
        self.icon = icon
        self.iconColor = iconColor
        self.title = title
        self.subtitle = subtitle
        self.isSelected = isSelected
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: DesignTokens.spacingSM) {
                Image(systemName: icon)
                    .font(.system(size: DesignTokens.iconMD))
                    .foregroundStyle(iconColor)
                    .frame(width: 18)

                VStack(alignment: .leading, spacing: 1) {
                    Text(title)
                        .font(.system(size: DesignTokens.fontSM, weight: isSelected ? .medium : .regular))
                        .foregroundStyle(.primary)
                        .lineLimit(1)

                    if let subtitle = subtitle {
                        Text(subtitle)
                            .font(.system(size: DesignTokens.fontXS))
                            .foregroundColor(.secondary.opacity(0.7))
                    }
                }

                Spacer()
            }
            .padding(.horizontal, DesignTokens.spacingSM)
            .padding(.vertical, 6)
            .background {
                if isSelected {
                    RoundedRectangle(cornerRadius: DesignTokens.radiusSM)
                        .fill(Color.accentColor.opacity(0.15))
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Footer Bar

struct FooterBar<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        HStack(spacing: DesignTokens.spacingSM) {
            content
        }
        .padding(.horizontal, DesignTokens.spacingMD)
        .padding(.vertical, DesignTokens.spacingSM)
        .frame(height: 40)
        .background(.bar)
    }
}

// MARK: - Divider with Label

struct LabeledDivider: View {
    let label: String

    var body: some View {
        HStack {
            Rectangle()
                .fill(Color.borderSecondary)
                .frame(height: 0.5)
            Text(label)
                .font(.system(size: DesignTokens.fontXS, weight: .medium))
                .foregroundColor(Color.secondary.opacity(0.6))
                .textCase(.uppercase)
            Rectangle()
                .fill(Color.borderSecondary)
                .frame(height: 0.5)
        }
    }
}
