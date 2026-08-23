import SwiftUI
import UIKit

@main
struct PikoShellApp: App {
    init() {
        UIApplication.shared.isIdleTimerDisabled = true
        LocalPikoGateway.shared.start()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
