# Piko — Cursor Agent 说明

用户从 Mac 迁回 Windows 后，**期望零手动配置**：Agent 应自动把项目跑起来，不要反复问「要不要启动服务」。

文档：[`README.md`](./README.md) · [`技术说明书.md`](./技术说明书.md) · **交互契约** [`交互基准.md`](./交互基准.md) · **中文总览/iPad** [`Piko中文交互说明与iPad就绪.md`](./Piko中文交互说明与iPad就绪.md)

## 打开本项目后（Windows，优先）

1. **立刻检查** `127.0.0.1:8000`、`8001`、`8765` 是否在监听
2. 若任一未运行，**直接执行**（无需用户确认）：

```powershell
powershell -ExecutionPolicy Bypass -File .\start-windows.ps1
```

3. 等待约 10–20 秒后验证：
   - `http://127.0.0.1:8001/health` → `{"status":"ok",...}`
   - Bridge 日志或 `:8765` 可连
   - 浏览器 `http://localhost:8000` 可开
4. **禁止**覆盖 `python-service\.venv\`；Python 用 `python-service\start-python.ps1`
5. Bridge：`COM3` @ **500000**（或环境变量 `SERIAL_PORT` / `SERIAL_BAUD`）；Arduino 串口监视器须关闭

## Mac 临时环境

```bash
./start-mac.sh
```

使用 `python-service/.venv-mac`，**不碰** Windows 的 `.venv`。

## 前端功能（跨平台）

- 录音持久化：`web-demo/sampleLibraryStore.js`（IndexedDB，浏览器本地）
- 画板多 brush：`web-demo/plateManager.js`（最多 5 段，共享 plate）

## Wi‑Fi 优先 / iPad（产品运行时）

- **生产**：[`ios/PikoShell`](./ios/PikoShell) 本机 `LocalPikoGateway` **:8001** + 内嵌 web-demo；ESP `WIFI_UPLOAD_HOST` = **iPad 热点 IP**（Settings 可见）。不依赖现场 Mac。
- **开发机（可选）**：Mac/PC Python `0.0.0.0:8001` + `web-demo` :8000；USB Bridge 仅桌面调试。
- **固件**：`esp32/wifi_secrets.h`；控制面 `:8080`；上传契约仍是 `POST /sounds/upload_pcm`
- **说明**：见 [`ios/PikoShell/README.md`](./ios/PikoShell/README.md) · [`Piko中文交互说明与iPad就绪.md`](./Piko中文交互说明与iPad就绪.md)

## 临时页（随时可删，非产品功能）

- `web-demo/brush-preview.html`、`brush-preview-presets.json`、`brush-stamps/` 是**随时要删**的笔刷对照/截图页
- 不要当正式入口、不要写进用户主流程；用户说删就整组删，无需迁移

## 可选：SiliconFlow Qwen3-Omni 语义分析

- 配置：`python-service/.env`（自 `.env.example` 复制，**勿提交** `.env`）
- 环境变量：`SILICONFLOW_API_KEY`、`SILICONFLOW_OMNI_MODEL`、`SILICONFLOW_BASE_URL`
- 生效点：`POST /analyze/wav` → Qwen `semantic.archetype` **决定** `strokePattern`；本地 `acousticFeatures` 决定类内 `brushParams`
- 失败：`semantic=null` + `semanticError`（无类别则不定笔刷算法）；映射见 `python-service/BRUSH_ACOUSTIC_MAPPING.md`
- 验证：`http://127.0.0.1:8001/health` 中 `omni.configured === true`
- **禁止**把 API Key 写进前端或对话日志

## 用户只说「跑起来 / 继续 / vibe coding」时

视为已授权自动启动上述服务，然后继续其请求的任务。

## Cursor Cloud specific instructions

云端 VM 是 **Linux**，没有 ESP32/INMP441 硬件串口，`.ps1` / `start-mac.sh` 都不适用。启动脚本已在 VM 启动时自动装好依赖（Python venv + bridge npm）。

**Python 虚拟环境**：云端用独立的 `python-service/.venv-linux/`（已在 `.gitignore`），**不要**碰 Windows `.venv` 或 Mac `.venv-mac`。系统依赖 `python3.12-venv` 已装进快照。

**如何运行（云端 Linux）：**

- Python 服务 `:8001`：`cd python-service && .venv-linux/bin/python -m uvicorn app:app --host 0.0.0.0 --port 8001`
  - 健康检查：`curl http://127.0.0.1:8001/health`（`status:ok`、`librosa:true`）
- 前端 `:8000`：`cd web-demo && npx --yes http-server -p 8000 -c-1`（纯静态，无需安装依赖）
- 测试：`cd python-service && .venv-linux/bin/python -m pytest -q`
- Bridge `:8765`：**依赖物理 ESP32 串口，云端无法真机运行**；硬件实时录音/直播流在云端无法完整验证。

**无硬件测端到端**：用前端 Library 页的「临时：上传本地音频文件」入口上传一个 WAV → 走完 Collect→Transform→Draw（`POST /analyze/wav` 即核心分析管线）。这是云端验证功能的推荐路径。

**画板绘画注意**：笔迹只在中间白色画布区（画布右侧 ~72%，`画笔` 工具激活时）内、按住鼠标**缓慢拖动**才会采样生成；快速点一下不出笔迹。`SILICONFLOW_API_KEY` 未配置时 `semantic` 为 `null`（本地分析不受影响）。
