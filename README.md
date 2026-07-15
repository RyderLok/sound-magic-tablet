# Piko — ESP32 Live Audio Pipeline

> **完整产品技术说明：** 见 [`技术说明书.md`](./技术说明书.md)（架构、工作流、模块、协议、部署）  
> **修改记录：** 见 [`CHANGELOG.md`](./CHANGELOG.md) 或说明书 §17

Real-time path from **ESP32 + INMP441** to **p5.js** generative visual system, with **Python** turning sound into visual structure (waveform, spectrum, spectrogram → features → brush).

```
ESP32 (INMP441 I2S)
        ↓ USB Serial (PCM binary + JSON metrics)
Node.js Serial Bridge
        ↓ WebSocket ws://localhost:8765
Frontend (hardware WAV + p5.js visuals)
        ↓ POST /analyze/wav + WebSocket ws://localhost:8001/ws/audio
Python FastAPI (librosa: waveform / spectrum / spectrogram → brush params)
```

## Hardware

| INMP441 | ESP32 |
|---------|-------|
| SCK (BCLK) | GPIO 14 |
| WS (LRCLK) | GPIO 15 |
| SD | GPIO 32 |
| VDD | 3.3V |
| GND | GND |
| L/R | GND (left channel) |

- Board: ESP32 Dev Module (ESP32-D0WD-V3)
- Sample rate: 16000 Hz
- Frame: 512 samples / JSON line
- Serial: **921600 baud** (required for PCM streaming)

## Startup (required order)

### 1. Flash ESP32 firmware

Open `esp32/inmp441_bridge.ino` in Arduino IDE:

- Board: **ESP32 Dev Module**
- Upload speed: 921600 (or default)
- Flash, then Serial Monitor @ **921600** — you should see:

```json
{"status":"ready","pcm":true,"rate":16000}
```

### 2. Install & run Node bridge

```bash
cd bridge
npm install
node serial-bridge.js --port COM3 --baud 921600
```

Replace `COM3` with your port (Windows: Device Manager → Ports).

Optional flags:

```bash
node serial-bridge.js --port COM3 --baud 921600 --ws 8765
```

Bridge logs:

- `[serial] pcm frame` — hardware audio during recording
- `[serial] parsed:` — live metrics
- `[ws] sent to N client(s)` — WebSocket broadcast

### 3. Start Python enhancement service

**Windows（推荐）：**

```powershell
cd python-service
.\start-python.ps1
```

First-time setup: `.\setup-python.ps1` (creates `python-service\.venv`).

Manual fallback:

```bash
cd python-service
pip install -r requirements.txt
python -m uvicorn app:app --host 127.0.0.1 --port 8001
```

**Mac（临时，不覆盖 Windows `.venv`）：** `./start-python-mac.sh`（使用 `.venv-mac`）

Health check: http://localhost:8001/health

### 4. Start frontend

```bash
cd web-demo
npx http-server -p 8000 -c-1
```

### 5. Open browser

http://localhost:8000

- Status bar: **ESP32 · Python · Brush Ready**
- **Start recording** captures audio from INMP441 (not the computer mic)
- Save → **分析** (可多次) → **Transform** → 勾选「画板」(最多 5 段) → **进入色盘画板** → 切换 brush 在同一块 plate 上绘画

## Cursor / AI 如何知道怎么跑

| 机制 | 作用 |
|------|------|
| **`start-windows.ps1`**（项目根） | 双击或 Agent 调用，一键开 Python + Bridge + 前端 + 浏览器 |
| **`AGENTS.md`** | Cursor Agent 必读：迁回 Windows 后自动 bootstrap |
| **`.cursor/hooks.json`** | 新 Agent 会话注入「请自动运行 start-windows.ps1」 |
| **`.cursor/rules/windows-runbook.mdc`** | 启动顺序与禁止覆盖 `.venv` |

**迁回 Windows 后你要做的：**

1. 整份文件夹拷到 Windows（含 `.cursor/`、`AGENTS.md`、`start-windows.ps1`）
2. 用 Cursor **Open Folder** 打开项目根目录
3. 新开 Agent 聊天 —— Agent 应自动跑 `start-windows.ps1`；若未自动，说「跑起来」即可

也可手动双击 **`start-windows.ps1`**（无需 Cursor）。

## Mode B — sound → visual structure

1. **Waveform** — time-domain amplitude envelope  
2. **Spectrum** — frequency energy distribution  
3. **Spectrogram** — time–frequency map  
4. **Features** — MFCC, bands, tempo, pitch → **Brush** → p5.js visuals  
5. **Semantic (optional)** — SiliconFlow `Qwen/Qwen3-Omni-30B-A3B-Instruct` open-ended audio understanding → `semantic` field  

API: `POST http://localhost:8001/analyze/wav` (multipart WAV file)

### Optional: SiliconFlow Qwen3-Omni semantic analysis

Server-side only (API Key never sent to the browser). When configured, `/analyze/wav` adds:

```json
"semantic": {
  "soundLabel": "...",
  "description": "...",
  "possibleSources": ["..."],
  "audibleEvents": ["..."],
  "confidence": 0.0
}
```

- Does **not** override local `naturalArchetype` / `strokePattern` / `brushParams`
- On missing key, timeout, or parse failure → `semantic: null` (local analysis unchanged)

Setup:

```bash
cd python-service
cp .env.example .env
# edit .env → set SILICONFLOW_API_KEY=sk-...
# restart Python service
```

Env vars: `SILICONFLOW_API_KEY`, `SILICONFLOW_OMNI_MODEL`, `SILICONFLOW_BASE_URL`, `SILICONFLOW_OMNI_ENABLED`  
Health: `http://127.0.0.1:8001/health` → `omni.configured`

## WebSocket message format

```json
{
  "level": 12345,
  "peak": 67890,
  "mean": -1234,
  "timestamp": 1710000000000
}
```

## Visual mapping

| ESP32 metric | Visual effect |
|--------------|---------------|
| `level` (RMS) | Particle sphere radius, density, volume |
| `peak` | Stipple flash intensity (alpha boost) |
| `mean` (DC offset) | Background drift, noise time offset |

## Project files

| Path | Role |
|------|------|
| `esp32/inmp441_bridge.ino` | I2S capture + JSON serial output |
| `bridge/serial-bridge.js` | Serial → WebSocket relay |
| `web-demo/esp32AudioAdapter.js` | Browser WebSocket client |
| `web-demo/pythonEnhancementClient.js` | Python WebSocket + REST client |
| `web-demo/featureSchema.js` | Unified feature schema adapter |
| `python-service/app.py` | FastAPI + librosa analysis + optional `semantic` |
| `python-service/siliconflow_omni.py` | SiliconFlow Qwen3-Omni semantic analysis |
| `python-service/.env.example` | Env template for Omni (copy to `.env`, gitignored) |
| `web-demo/generativeField.js` | Sound breathing (ESP32-aware) |
| `web-demo/brushGenerator.js` | Draw brush (ESP32-aware) |
| `web-demo/sampleLibraryStore.js` | IndexedDB 录音持久化 |
| `web-demo/plateManager.js` | 画板多 brush（最多 5） |
| `python-service/start-python.ps1` | Windows 一键启动 Python |
| `bridge/start-bridge-mac.sh` | Mac 临时 Bridge（可选） |

## Constraints preserved

- Existing canvas layout unchanged
- `featureSchema.js` + `esp32AudioAdapter` unify hardware metrics for AI layer
- Real-time streaming only (no file buffering in this pipeline)
- Ready for future FFT / AI layer on top of `toAnalyzerFeatures()`

## Troubleshooting

| Issue | Check |
|-------|--------|
| `ESP32 offline` in browser | Bridge running? Port 8765 free? |
| No serial data | Correct COM port? Baud **921600**? USB cable supports data |
| Flat waveform | INMP441 wiring, L/R → GND, 3.3V not 5V |
| Permission error (serial) | Close Arduino Serial Monitor before starting bridge |

## Future extensions

- Send raw PCM frames (`type: "pcm"`) for FFT in browser
- Bridge-side WAV capture for Library upload
- `start` / `stop` commands from frontend → ESP32
