# Piko · UI 设计 PRD 与信息架构

**版本：** 1.0  
**日期：** 2026-07-16  
**用途：** 供 UI / 视觉设计直接使用（页面树、对象模型、交互主路径、验收标准）  
**事实源：** 当前 `web-demo` + `python-service` 实现；技术细节见 [`技术说明书.md`](./技术说明书.md)

---

## 1. 产品一句话

**Piko**：用 ESP32 采自然声 → 变成「活的视觉材料」→ 用它在画布上画。

页头工作流：**Collect → Transform → Draw**

核心理念：

> Discover a sound · Record it · Watch it become living material · Draw with it  
> 声音是**材料**，不是单纯播放对象。

---

## 2. 信息架构（IA）

### 2.1 三层主结构（终版产品面）

```
┌─────────────────────────────────────────────┐
│  全局：品牌 / 步骤 Collect→Transform→Draw    │
│  （弱化）设备连接状态                          │
└─────────────────────────────────────────────┘
          │
    ┌─────┴─────┬──────────────┐
    ▼           ▼              ▼
 Collect      Transform       Draw
 Library      材料化管线      画室
              （单样本）      ├─ 单样本 Studio
                            └─ 色盘 Plate Studio（≤5）
```

| 层级 | 页面/模块 | 用户在做什么 | 核心对象 |
|------|-----------|--------------|----------|
| L1 | **Library（Collect）** | 录、存、管、选材料 | Sound Sample |
| L2 | **Transform** | 看声音如何变成笔刷材料 | 同一 Sample 的分析过程 |
| L3 | **Draw** | 用材料画画 | Canvas + 当前 Brush |
| L3b | **Plate Studio** | 多段材料共用一块画板 | Plate（≤5 brushes） |
| Overlay | **声学分析弹窗** | 波形/频谱 + 应用 Brush（快捷） | Analysis snapshot |

### 2.2 对象模型

| 对象 | 用户语言 | 关键属性 | 上限/规则 |
|------|----------|----------|-----------|
| **Sample** | 一段声音 / 材料 | 名称、时长、状态、波形、来源 ESP32 | IndexedDB 本地持久化 |
| **状态** | Ready → Transforming → Material ready | 决定能否 Transform / 进画板 | — |
| **Brush / Material** | 画笔材料 | 五类造型之一 + 颜色/密度等 | 由声学映射；非用户手选「画笔种类」为主 |
| **Plate** | 色盘画板 | 已勾选的 Sample 列表 | **最多 5** |
| **语义标签** | 「这是什么声」 | Qwen 五类 + 描述 | **只解释，不改笔触造型** |
| **画布** | Plate / 画室 | 笔迹、工具（画/擦） | Plate 内换 brush **不清空**笔迹 |

### 2.3 五类声音材料 → 笔触造型

| 自然声类 | 中文 | 笔触气质 | Pattern id |
|----------|------|----------|------------|
| birds | 鸟类 | 点彩、跳跃、稀疏 | `scatter_points` |
| wind_leaves | 风与树叶 | 流场、雾感、连续 | `flow_field` |
| water | 水 | 涟漪、波浪 | `wave_ripple` |
| material_impact | 材质撞击 | 爆发、冲击 | `impact_burst` |
| insects_amphibians | 昆虫两栖 | 脉冲、栅格、节律 | `pulse_grid` |

设计要求：Library 卡、Transform 结果、Draw 材料条、语义结果共用**同一套五类视觉隐喻**。

---

## 3. 交互逻辑

### 3.1 主流程

```
Library 录音 → 命名入库
       ├─ Transform 六步 → Enter Visual Studio → Draw 单样本
       ├─ 分析弹窗 → 应用 Brush →（可进）Draw
       └─ 勾选 ≤5 → 进入色盘画板 → Plate Studio（顶条切换 brush）
```

### 3.2 分场景

**Collect（录音）**  
Start（或 Keyes）→ 录音中（电平/时长）→ Stop → 试听 → 命名 → Save。  
约束：仅 ESP32 + INMP441；太短/无 PCM → 失败，不入库。

**Library**  
卡操作：播放 · 分析 · Transform · 加入/移出色盘 · 删除。  
色盘：`n/5` +「进入色盘画板」（未就绪不可进）。

**Transform**  
步骤叙事：Acoustic → Extract → Map → Materialize。  
内容约六步：波形/频谱/声谱图 → 音量 → FFT → Pitch&Timbre → Visual mapping → Sound breathing。  
CTA：Enter Visual Studio（已在色盘 → Plate；否则单样本 Draw）。

**Draw · 单样本**  
顶：材料预览 · 左：Sound Breathing · 中：画布（画/擦/清空）· 右：解读（声学 + 可选语义）。

**Plate Studio**  
复用 Draw；顶条切换 ≤5 brush；共享画板，换材料不清空笔迹。

**语义（Qwen）**  
展示五类识别 + 短描述；失败「声音识别失败，请重试」；**不**主控笔触造型。

### 3.3 导航

| 从 | 到 | 触发 |
|----|-----|------|
| Library | Transform | 卡上 Transform |
| Library | 分析弹窗 | 分析 |
| Library | Plate | 勾选就绪样本 → 进入色盘画板 |
| Transform | Draw / Plate | Enter Visual Studio |
| Draw / Plate | Library | 返回 |

---

## 4. 轻量 PRD

### 4.1 目标与受众

| | |
|--|--|
| **目标** | 完成「采声 → 变材料 → 画画」，并理解材料从哪来 |
| **主受众** | 儿童 / 自然教育场景；少字、强反馈 |
| **次受众** | 开发联调（状态条等终版弱化） |

### 4.2 设计可验收标准

1. 新用户约 **3 步**理解：录 → 变材料 → 画一笔  
2. Library 一眼区分 Ready / Material ready / 已在色盘  
3. Transform 像「声音变成画笔」，不是仪表盘  
4. Plate：清楚当前用哪段声；换段不丢画  
5. 五类材料视觉可区分（色、动势、纹理）

### 4.3 In scope（必须有）

1. Library：录音区 + 列表 + 色盘摘要  
2. Transform：过程叙事 + 进画室  
3. Draw：画布 + 材料预览 + Breathing + 工具  
4. Plate 顶条切换  
5. 分析弹窗（可作次要入口）  
6. 轻量失败提示（录不了 / 分析不了 / 语义失败）

### 4.4 Out of scope（终版勿作主路径）

- 「临时上传本地音频」  
- Python 集成 setup 长列表  
- Debug Features 面板  
- 过重三服务状态条（可收纳进「连接」）

### 4.5 文案策略

现状中英混杂。建议：

- **儿童面**：全中文短句  
- **步骤名**：可用 Collect / Transform / Draw 作图标化步骤  

### 4.6 约束（影响布局）

| 约束 | UI 影响 |
|------|---------|
| Plate ≤ 5 | 固定 5 槽；满员禁用「＋」 |
| IndexedDB 本地 | 换电脑库空；需要空态文案 |
| 硬件录音 | Collect 空态教「接好小板再录」 |
| 语义失败不挡画 | 语义区可失败，画室仍可用 |
| 二次分析 | 「材料已更新」反馈；Plate 笔迹默认保留 |

### 4.7 建议设计稿页清单

1. Library · 空态（无硬件 / 无样本）  
2. Library · 录音中  
3. Library · 有样本 + 色盘 0～5  
4. Transform · 进行中  
5. Transform · 完成 CTA  
6. Draw · 单样本  
7. Plate Studio  
8. 分析弹窗  
9. 错误态：无 PCM / Python 断 / 语义失败  
10.（可选）连接设置收纳  

### 4.8 视觉原则

- 第一屏一个构图，勿做成仪表盘  
- Brand **Piko** 要够强  
- 少卡片；交互容器才用「卡」  
- 每区一件事：录 / 变 / 画  
- 动效表达「呼吸、材料活着」  
- 自然声气质：有机、户外、材质感（避免通用 AI 紫渐变模板脸）  

---

## 5. 导航地图（一页）

```
[ Piko ]
 Collect ──────── Transform ──────── Draw
    │                  │               │
 录音+库            六步材料化        画布+呼吸球
 色盘 n/5             │               │
    └──── 进入色盘 ────┴── Plate 顶条切换 brush
```

---

## 6. 实现锚点（给设计对照代码）

| 区域 | 主要文件 |
|------|----------|
| 三视图 DOM | `web-demo/index.html`、`style.css` |
| 路由 / Library / Plate | `web-demo/app.js`、`plateManager.js` |
| 持久化 | `web-demo/sampleLibraryStore.js` |
| 录音 | `fieldRecorder.js`、`esp32AudioAdapter.js` |
| Transform | `soundTransformView.js` |
| 分析弹窗 | `acousticAnalysisWindow.js` |
| 画布 / 笔刷 | `canvasInteraction.js`、`brushGenerator.js`、`membraneSphere.js` |
| 五类映射 | `naturalSoundArchetypes.js`、Python `natural_sound_archetypes.py` |
| Qwen 语义 | `python-service/siliconflow_omni.py`（灰度五类） |

---

## 7. 文档关系

| 文档 | 用途 |
|------|------|
| **本文** | UI / IA / 轻量 PRD |
| [`技术说明书.md`](./技术说明书.md) | 全栈技术说明 |
| [`README.md`](./README.md) | 快速启动与仓库入口 |
| [`AGENTS.md`](./AGENTS.md) | Cursor Agent 运行约定 |
