import SwiftUI

@main
struct PikoShellApp: App {
    init() {
        LocalPikoGateway.shared.start()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
