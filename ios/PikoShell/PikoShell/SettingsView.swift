import SwiftUI

struct SettingsView: View {
    @ObservedObject var config: PikoRuntimeConfig
    @ObservedObject private var supabase = SupabaseConfig.shared
    @ObservedObject private var silicon = SiliconFlowConfig.shared
    @Environment(\.dismiss) private var dismiss
    @State private var testingCloud = false
    @State private var cloudTestMessage = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("独立模式（产品默认）") {
                    Toggle("本机网关 + 内嵌网页", isOn: $config.standaloneMode)
                    LabeledContent("网关") {
                        Text(LocalPikoGateway.shared.isRunning ? "运行中 :\(LocalPikoGateway.port)" : "未启动")
                            .foregroundStyle(LocalPikoGateway.shared.isRunning ? .green : .orange)
                    }
                    LabeledContent("ESP 上传地址") {
                        Text(config.lanUploadURL)
                            .font(.footnote.monospaced())
                            .textSelection(.enabled)
                    }
                    Text("把上面的 IP 写入 ESP wifi_secrets.h 的 WIFI_UPLOAD_HOST。热点需 2.4GHz。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Supabase（必须：历史 + 新录音进云）") {
                    LabeledContent("云端") {
                        Text(supabase.isConfigured ? "已配置" : "缺 anon key")
                            .foregroundStyle(supabase.isConfigured ? .green : .red)
                    }
                    TextField("Project URL", text: $supabase.url)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                    SecureField("anon public key（禁止 service_role）", text: $supabase.anonKey)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    TextField("bucket", text: $supabase.bucket)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()

                    if supabase.looksLikeServiceRole(supabase.anonKey) {
                        Text("检测到 service_role — 请改成 Dashboard → API → anon public。")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }

                    Button {
                        runCloudSelfTest()
                    } label: {
                        if testingCloud {
                            ProgressView()
                        } else {
                            Text("测试云端读写（list→upload→download→cleanup）")
                        }
                    }
                    .disabled(testingCloud || !supabase.isConfigured)

                    if !cloudTestMessage.isEmpty {
                        Text(cloudTestMessage)
                            .font(.footnote)
                            .foregroundStyle(cloudTestMessage.hasPrefix("OK") ? .green : .orange)
                    } else if !supabase.lastSelfTestSummary.isEmpty {
                        Text(supabase.lastSelfTestSummary)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }

                    Text("一次到位：1) SQL Editor 执行 python-service/supabase_sounds.sql  2) 粘贴 anon key  3) 点测试直到显示 OK。之后 ESP 上传与 Mac 历史都走同一 sounds 库。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Qwen / SiliconFlow（语义分析）") {
                    SecureField("SILICONFLOW_API_KEY", text: $silicon.apiKey)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Text(silicon.isConfigured ? "已配置 — /analyze/wav 可用" : "未配置 — 画板语义分析会失败")
                        .font(.footnote)
                        .foregroundStyle(silicon.isConfigured ? .green : .secondary)
                }

                Section("ESP32 HTTP（可选）") {
                    TextField("http://172.20.10.5:8080", text: $config.esp32Base)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                }

                Section("开发回退（连 Mac，可选）") {
                    Text("关闭「本机网关」后可加载 Mac web-demo。Mac Python 仍可用 service_role。")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    TextField("Mac web-demo", text: $config.demoBase)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                        .disabled(config.standaloneMode)
                    TextField("Mac API", text: $config.apiBase)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .autocorrectionDisabled()
                        .disabled(config.standaloneMode)
                }
            }
            .navigationTitle("Piko Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .onAppear {
                LocalPikoGateway.shared.start()
            }
        }
    }

    private func runCloudSelfTest() {
        testingCloud = true
        cloudTestMessage = "测试中…"
        Task {
            let report = await SupabaseSoundsClient.selfTest()
            let ok = (report["ok"] as? Bool) == true
            let hint = report["hint"] as? String ?? ""
            var detail = ok ? "OK — \(hint)" : "FAIL — \(hint)"
            if let steps = report["steps"] as? [[String: Any]] {
                let failed = steps.filter { ($0["ok"] as? Bool) != true }
                if let first = failed.first {
                    detail += " |\(first["step"] ?? "?")|: \(first["detail"] ?? "")"
                }
            }
            await MainActor.run {
                supabase.lastSelfTestSummary = detail
                cloudTestMessage = detail
                testingCloud = false
            }
        }
    }
}
