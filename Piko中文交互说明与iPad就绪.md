# Piko 中文说明：交互逻辑 · 独立 iPad · 现状

> **产品北星**  
> 最终用户场景：**iPad App 独立运作**——日常不依赖旁边再开一台 Mac/PC 跑 Python。  
> ESP32 + 手机热点 + iPad，完成：录音 → 入库 → 曲库 →（后续）笔刷/画板。  
> Mac/PC + USB Bridge = **开发脚手架**，不是终态拓扑。

协议细则见 [`交互基准.md`](./交互基准.md)。

---

## 一、终态拓扑（已按此实现第一期）

```text
        手机热点
     ┌──────┴──────┐
     ▼             ▼
  ESP32         iPad App
  录音/按键      ├─ 内嵌 web-demo（:8001 静态）
  :8080  ◀─────▶├─ LocalPikoGateway :8001
     │          │    /health · /sounds/upload_pcm · /sounds
     └─ PCM ────▶└─ Documents 本地曲库
```

开发机可选：同一固件也可把 PCM 传到 Mac Python `:8001`（路径未删）。

---

## 二、已验证 / 已落地

| 能力 | 状态 |
|------|------|
| 硬件按键 + 异步 Wi‑Fi 上传契约 | ✅ 固件 |
| Mac Python 收 `esp32-wifi` | ✅ 开发联调 |
| **iPad 本地收 PCM + 曲库 + 内嵌网页** | ✅ `ios/PikoShell` |
| **iPad 写入 / 读取 Supabase（anon）** | ✅ Settings 配 anon + 执行 `supabase_sounds.sql` + 应用内「测试云端」 |
| **iPad 调 Qwen `/analyze/wav`** | ✅ Settings 配 SiliconFlow API Key |
| USB 实时波形 | 仅 Mac；iPad 非目标 |

### Supabase 一次配齐（声音进云）

1. SQL Editor 跑 [`python-service/supabase_sounds.sql`](./python-service/supabase_sounds.sql)  
2. App Settings 粘贴 **anon public**（禁 service_role）  
3. 点「测试云端读写」直到 **OK**  
4. 可选：`SUPABASE_ANON_KEY=… python3 python-service/verify_ipad_supabase.py`

---

## 三、独立闭环怎么测

1. Xcode 打开 `ios/PikoShell`，真机 Run  
2. Settings 确认「本机网关」开着，复制 **ESP 上传地址**  
3. ESP `WIFI_UPLOAD_HOST` = 该 iPad IP，烧录  
4. 只开热点 + ESP + iPad（Mac 可不跑 Python）  
5. 按键录音 → Library 出现可播条目  

---

## 四、改代码时

- 不变量与端点名：[`交互基准.md`](./交互基准.md)  
- iPad 工程操作：[`ios/PikoShell/README.md`](./ios/PikoShell/README.md)  
- **禁止**把 `SUPABASE_SERVICE_ROLE` 打进 App  
- Mac 启动脚本默认行为不要为了 iPad 改坏  

---

*第一期交付：接收端迁到 iPad，Mac 路径并存。*
