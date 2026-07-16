# Piko — Cursor Agent 说明

用户从 Mac 迁回 Windows 后，**期望零手动配置**：Agent 应自动把项目跑起来，不要反复问「要不要启动服务」。

文档：[`README.md`](./README.md) · [`技术说明书.md`](./技术说明书.md) · [`UI设计PRD与信息架构.md`](./UI设计PRD与信息架构.md)

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

## 可选：SiliconFlow Qwen3-Omni 语义分析

- 配置：`python-service/.env`（自 `.env.example` 复制，**勿提交** `.env`）
- 环境变量：`SILICONFLOW_API_KEY`、`SILICONFLOW_OMNI_MODEL`、`SILICONFLOW_BASE_URL`
- 生效点：`POST /analyze/wav` → `semantic`（灰度五类，与本地 archetype 同 id）
- **不**覆盖本地 `strokePattern` / `brushParams`；失败则为 `null` + `semanticError`
- 验证：`http://127.0.0.1:8001/health` 中 `omni.configured === true`
- **禁止**把 API Key 写进前端或对话日志

## 用户只说「跑起来 / 继续 / vibe coding」时

视为已授权自动启动上述服务，然后继续其请求的任务。
