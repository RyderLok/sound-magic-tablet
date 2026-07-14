# 修改记录（Changelog）

Sound Magic Tablet 项目变更日志。**最新记录在顶部。**

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
