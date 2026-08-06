import SwiftUI

struct ContentView: View {
    @StateObject private var config = PikoRuntimeConfig()
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            ZStack {
                WebContainerView(urlString: config.startURL)
                    .ignoresSafeArea(edges: .bottom)
            }
            .navigationTitle("Piko")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel("Settings")
                }
            }
            .sheet(isPresented: $showSettings) {
                SettingsView(config: config)
            }
            .onAppear {
                LocalPikoGateway.shared.start()
            }
        }
    }
}

#Preview {
    ContentView()
}
