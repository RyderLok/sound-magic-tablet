# 修改记录（Changelog）

Piko 项目变更日志。**最新记录在顶部。**

> 完整产品说明见 [`技术说明书.md`](./技术说明书.md) §17。  
> 新增记录请复制下方模板，插入本文件最上方。

```markdown
### YYYY-MM-DD · vX.X — 标题

| 项 | 内容 |
|----|------|
| **摘要** | … |
| **涉及文件** | … |
| **原因/备注** | … |
```

---

### 2026-07-18 · v1.5 — Qwen 定类 + 本地类内笔刷

| 项 | 内容 |
|----|------|
| **摘要** | Qwen 决定 `strokePattern`；本地声学只做类内 `brushParams`；分轴映射，音量不再连坐 |
| **涉及文件** | `acoustic_features.py`、`brush_mapper.py`、`brushGenerator.js`、`BRUSH_ACOUSTIC_MAPPING.md`、`README.md`、`技术说明书.md` |
| **原因/备注** | 同类异录要有可见差异；五套算法保留 |

---

### 2026-07-16 · v1.4 — 产品流文档对齐

| 项 | 内容 |
|----|------|
| **摘要** | README / 技术说明书对齐 Collect→Transform→Draw、Plate≤5、IndexedDB（当时仍写 Qwen 不改笔刷算法） |
| **涉及文件** | `README.md`、`技术说明书.md`、`CHANGELOG.md` |
| **原因/备注** | UI PRD 文件后续已删除 |

---

### 2026-07-15 · v1.3 — SiliconFlow Qwen3-Omni 语义分析

| 项 | 内容 |
|----|------|
| **摘要** | `/analyze/wav` 可选接入硅基流动 `Qwen/Qwen3-Omni-30B-A3B-Instruct`，返回 `semantic`；失败为 `null`，不改写本地 brush（后续灰度五类见 v1.4） |
| **涉及文件** | `python-service/siliconflow_omni.py`、`app.py`、`schemas.py`、`config.py`、`.env.example`、`README.md`、`技术说明书.md`、`AGENTS.md` |
| **原因/备注** | Key 仅服务端 `.env`；`health.omni.configured` 可检查是否启用 |

---

### 2026-06-17 · v1.2 — ESP32 硬件 PCM 录音

| 项 | 内容 |
|----|------|
| **摘要** | 录音改走 ESP32 PCM → WAV，不再使用电脑麦克风 |
| **涉及文件** | `inmp441_bridge.ino`、`serial-bridge.js`、`fieldRecorder.js`、`wavEncoder.js`、`esp32AudioAdapter.js` |

---

### 2026-06-17 · v1.1 — 补充修改记录章节

| 项 | 内容 |
|----|------|
| **摘要** | 在 `技术说明书.md` 新增 §17 修改记录；新建本 `CHANGELOG.md` |
| **涉及文件** | `技术说明书.md`、`CHANGELOG.md` |

---

### 2026-06-17 · v1.0 — 移除文件上传入口

| 项 | 内容 |
|----|------|
| **摘要** | 删除 Import 按钮与上传区 |
| **涉及文件** | `web-demo/index.html`、`web-demo/app.js`、`web-demo/fieldRecorder.js` |

---

### 2026-06-17 · v1.0 — 现场录音采集（Collect）

| 项 | 内容 |
|----|------|
| **摘要** | FieldRecorder：开始/停止/命名/保存；Collect → Transform → Draw |
| **涉及文件** | `web-demo/fieldRecorder.js`、`index.html`、`app.js`、`style.css` |

---

### 2026-06-17 · v1.0 — Bridge Legacy 固件兼容

| 项 | 内容 |
|----|------|
| **摘要** | 解析 `音量: XX%` 等中文串口输出 |
| **涉及文件** | `bridge/serial-bridge.js` |

---

### 2026-06-17 · v1.0 — ESP32 实时管线

| 项 | 内容 |
|----|------|
| **摘要** | 固件 + Bridge + esp32AudioAdapter + 可视化联动 |
| **涉及文件** | `esp32/`、`bridge/`、`web-demo/esp32AudioAdapter.js` 等 |

---

### 2026-06-17 · v1.0 — Transform 滚动示波器与管线页

| 项 | 内容 |
|----|------|
| **摘要** | soundTransformView 六步管线；波形滚动/去晕眩优化 |
| **涉及文件** | `web-demo/soundTransformView.js` |

---

### 2026-06-17 · v1.0 — Sound Breathing & 呼吸画笔

| 项 | 内容 |
|----|------|
| **摘要** | generativeField 粒子场；brushGenerator 活体笔触 |
| **涉及文件** | `generativeField.js`、`brushGenerator.js`、`canvasInteraction.js` |

---

| 版本 | 日期 | 说明 |
|------|------|------|
| v1.1 | 2026-06-17 | 修改记录机制 |
| v1.0 | 2026-06-17 | 首个可演示完整版本 |
