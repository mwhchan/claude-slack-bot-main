//
//  View+Extensions.swift
//  ClaudeBotMonitor
//
//  Created by Accedo on 2026-01-11.
//

import SwiftUI
@_spi(Advanced) import SwiftUIIntrospect

extension View {

    func preventSidebarCollapse() -> some View {
        self
            .introspect(.navigationSplitView, on: .macOS(.v14...)) { splitView in
            if let delegate = splitView.delegate as? NSSplitViewController {
                  delegate.splitViewItems.first?.canCollapse = false
                  delegate.splitViewItems.first?.canCollapseFromWindowResize = false
            }
        }
      }
}
