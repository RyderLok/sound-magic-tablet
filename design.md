# Piko · UI 设计规范（开发落地版）

**来源：** [PIKO-UI-DESIGN](https://www.figma.com/design/RnSotgImMJKJhISkDjNdNm/PIKO-UI-DESIGN?node-id=0-1)
**整理日期：** 2026-08-01
**适用：** `web-demo/` 前端实现与视觉验收
**定位：** 本文件是 **UI 唯一事实来源（Source of Truth）**。数值全部来自 Figma 实测节点，可直接对照写码。

---

## 0. 开发铁律（务必先读）

> 用户要求：**严格按照 Figma 界面开发**。以下为不可协商项。

1. **配色只用第 3 节 Token**，主色 `#F16E1C`。禁止沿用旧灰色主题（`#17202a` / `#eeedea` 等）。
2. **字体主展示用阿里妈妈方圆体**（Alimama FangYuanTi VF）。禁止把 Inter / 系统字体当作标题主字体。
3. **圆角、阴影、间距** 一律取本文件数值，不自创。可点控件无尖角。
4. **文案与稿一致**，仅修正明显笔误：`Darw→Draw`、`platte→palette`。
5. **像素对照**：每屏按第 7 节红线表实现，允许用响应式换算，但相对比例、层级、对齐必须与稿一致。
6. **改动前后都要与 Figma 截图比对**；拿不准的尺寸回到 Figma 取值，不要猜。
7. **不确定的视觉决策先问**，不要用旧代码风格「兜底」。

⚠️ **现状差距（重要）**：当前 `web-demo/style.css` 仍是灰色 + Inter 旧主题，与本规范不符。后续开发需按本文件迁移到橙色 Piko 体系（见第 8 节）。

---

## 1. 产品气质

- **一句话：** Catch a sound. Make a world.
- **调性：** 友好、圆润、儿童 / 家庭向创作工具；大触控、少文字、强主色引导。
- **主路径：** 采音 → 选声 → 变笔刷 → 画板作画 → 图库 → 打印。

---

## 2. 画布与栅格

| 项 | 值 | 说明 |
|----|----|------|
| 设计基准 | **1055 × 834**（横屏平板） | Figma 各屏 `1054.65 × 834` |
| 页边距 | **30–31px** | 内容左起 `left: 30/31` |
| 标题基线 | `top: 53–56` | 页标题统一起点 |
| 圆形导航区 | `top: 60`，Ø 61 | 左上返回 / 右上菜单 |
| 底部 CTA 带 | 距底 `~50–70` | 主按钮固定右下 |
| 对齐 | 标题居中；内容左对齐或居中；主 CTA 右下 | 见各屏红线 |

**响应式建议：** 以基准比例做等比缩放（`min(100vw, 100vh*1055/834)` 容器），或用 flex/grid 还原相对布局；保持组件相对位置与层级不变。

---

## 3. 设计 Token

Figma 未建 Variables，以下为界面实测采样值，落地请统一走 CSS 变量。

### 3.1 颜色

| Token | Hex | 用途 |
|-------|-----|------|
| `--piko-orange` | `#F16E1C` | 主色：页标题、实心 CTA、选中边框、波形、导航圆钮、磁贴底 |
| `--piko-yellow` | `#FDBF42` | 品牌点缀（Logo 火花）、Collect 图标描边/填充 |
| `--piko-cream` | `#F9F8F4` | 卡片 / 预览板 / 声卡底 / 画板外表面 |
| `--piko-white` | `#FFFFFF` | 页面底、按钮字、图标 |
| `--piko-text` | `#535353` | 正文、说明、列表名 |
| `--piko-muted` | `#CACACA` | 等待态、未选计数、未选圈 |
| `--piko-muted-2` | `#9A9A9A` | 次要文本操作（如 Add to palette） |

### 3.2 画板色盘（最多 5 槽）

橙底 pill 内嵌 5 个圆角色块 + `⋯`。稿面示意色（实现可与「声→色」引擎输出对齐，数量上限固定 5）：

| 槽 | 示意色 |
|----|--------|
| 1 | 天蓝 |
| 2 | 淡紫 |
| 3 | 粉 |
| 4 | 琥珀黄 |
| 5 | 薄荷绿 |

### 3.3 阴影 / 描边 / 效果

| Token | 值 | 用途 |
|-------|----|------|
| `--piko-shadow` | `0 4px 4px rgba(0,0,0,0.25)` | 卡片、CTA、圆钮通用投影 |
| `--piko-inset` | `inset 0 0 4px rgba(0,0,0,0.25)` | 波形槽内阴影 |
| `--piko-border-sel` | `2px solid #F16E1C` | 选中 / 强调描边 |
| 魔法球模糊 | `blur(2px)` + 外橙 glow | 仅 Transform 球体 |

### 3.4 圆角

| Token | 值 | 用途 |
|-------|----|------|
| `--piko-radius-card` | `20px` | 内容卡 / 预览板 / 波形槽 / 笔刷行 |
| `--piko-radius-sound` | `30px` | 声卡（竖卡） |
| `--piko-radius-cta` | `40px` | 实心主按钮 |
| `--piko-radius-pill` | `60px` | outline 状态胶囊 |
| `--piko-radius-tile` | `100px` | Collect 主磁贴（squircle） |
| `--piko-radius-tile-sm` | `89px` | Collect 侧磁贴 |
| 圆钮 / 选区圈 | `50%` | 完全圆形 |

### 3.5 字体

| 项 | 值 |
|----|----|
| 主字体 | `"Alimama FangYuanTi VF"`（方圆体） |
| 回退 | `"PingFang SC", system-ui, sans-serif`（圆润无衬线，勿用 Inter/Roboto 当主字体） |
| 字重 | **Bold**（页标题）、**SemiBold**（正文 / 按钮 / 列表） |

**字号阶梯：**

| 角色 | 字号 | 字重 | 颜色 |
|------|------|------|------|
| 页标题 | 36 | Bold | `#F16E1C` |
| 启动 Slogan | 20 | SemiBold | `#F9F8F4` |
| 主说明（Collect/My sounds） | 32 | SemiBold | `#535353` |
| Transform 状态文案 | 36 | SemiBold | `#535353` |
| 区块标题（Your Sound Brushes 等） | 24 | SemiBold | `#535353` |
| 实心 CTA 字 | 24 | SemiBold | `#FFFFFF` |
| Outline 状态标签（Brush Blooming） | 28 | SemiBold | `#F16E1C` |
| 磁贴标签（Input 等） | 21–24 | Bold | `#FFFFFF` |
| 列表名 / 时长（列表页） | 16 | SemiBold | 名 `#535353`；时长视场景 `#535353`/`#F16E1C` |
| 声卡名 | 20 | SemiBold | `#535353` |
| 声卡时长 | 16 | SemiBold | `#F16E1C` |
| 弱提示（Waiting / 0 selected） | 24 | SemiBold | `#CACACA` |
| 次要操作（Add to palette） | 20 | SemiBold | `#9A9A9A` |

---

## 4. 组件库（含状态）

统一：投影 `--piko-shadow`；触控热区圆钮 ≥ 56，主 CTA 高 ≥ 53。

### 4.1 页标题 `PageTitle`
- 橙 `#F16E1C`，36 / Bold，`top:53–56`。多为居中，Sound Brush 等左置。

### 4.2 圆形导航钮 `IconButton`
- Ø 61（Collect 内小图钮 Ø 56），橙底 + 白 glyph，`--piko-shadow`。
- 变体：`back`（左 chevron）、`menu/select`（汉堡+勾选）、`save`、`waveform`、`eraser`。
- 态：默认 / 按下（可轻微缩放）/ 禁用（降透明）。

### 4.3 实心主按钮 `PrimaryButton`
- 填充 `#F16E1C`，白字 24 SemiBold，圆角 40，`--piko-shadow`；右下定位。
- 文案：`Next Step` / `Use Brush` / `Print`。
- 尺寸参考：宽 281–317，高 53–67。
- 态：默认 / hover 微亮 / 禁用（灰化，用于「0 selected」时）。

### 4.4 Outline 状态胶囊 `StatusPill`
- 白底 + `2px #F16E1C` + 橙字 28；圆角 60；可带前置星形 icon。例：`Brush Blooming`。

### 4.5 文本次操作 `TextMeta`
- 无框，`#9A9A9A` 20。例：`Add to palette: 0/5`。

### 4.6 声卡 `SoundCard`（My sounds）
- 底 `#F9F8F4`，圆角 30，`--piko-shadow`；卡面约 219×379。
- 结构（上→下）：选中圈（Ø30，未选灰空心）→ 名称（20 `#535353`）→ 波形槽（白底 197×54 圆角 20 + `--piko-inset`，内橙波形）→ 播放圆钮（橙 + 白三角）+ 时长（16 `#F16E1C`）。
- 态：未选 / 选中（橙边或橙填充圈 + 计数 +1）；上限 5，达上限其余禁用。

### 4.7 笔刷行 `BrushRow`（Sound Brush 左栏）
- 317×102，圆角 20，`2px #F16E1C`；默认透明底，选中加 `#F9F8F4` + 阴影。
- 内含：播放钮 + 名（16 `#535353`）+ 时长 + 波形。

### 4.8 预览板 `PreviewPanel`（Sound Brush 右栏）
- `#F9F8F4`，596×336，圆角 20；顶部「Made From a Sound」信息条（596×57，橙边圆角 20）。

### 4.9 Collect 磁贴 `CollectTile`
| 序号 | 标签 | 尺寸 | 态 |
|------|------|------|----|
| 1 | Input | 350×350 圆角 100 | 中心主态（最大，不透明） |
| 2 | My Gallery | 312×312 圆角 89 | 右侧，opacity 0.8 |
| 3 | Draw | 312×312 圆角 89 | 左侧，opacity 0.8 |
- 橙底 + 白圈序号角标 + 白/黄线图标 + 白标签；底部 `Waiting for recorder...`（`#CACACA` 24）。

### 4.10 画板顶栏 `CanvasToolbar`
- 左：返回圆钮；中：橡皮擦圆钮 + 色盘 pill（橙底，5 色块 + `⋯`）；右：保存圆钮。
- 画布：纯白全幅。

### 4.11 图库卡 `GalleryCard`
- `#F9F8F4`，305×216，圆角 ~15–20，`--piko-shadow`；约 3 列网格，统一 gutter。
- 管理模式：左上选中圈（Ø25，`#CACACA` 空心）；选中后右下出现 `Print` CTA。

### 4.12 魔法球 `MagicOrb`（Transform）
- 居中半透明虹彩球（约 285×288，`blur(2px)`）+ 外橙径向 glow（约 369 圈）。

---

## 5. 图标

- 线性风格，等宽描边，圆头圆角接合；橙或白填充。
- 已知：返回 chevron、菜单/勾选、存盘、波形、橡皮、播放三角、Logo 火花、星形 spark、画笔/调色盘、相框。
- 矢量资源请从 Figma 导出提交（MCP 资产 URL 约 7 天过期，勿直接长期引用）。

---

## 6. 页面流（1–9）

| # | 名称 | 节点 | 底色 | 职责 |
|---|------|------|------|------|
| 1 | Splash | `1:3` | 橙 | 品牌启动：Logo + Slogan |
| 2 | Collect | `1:14` | 白 | 插录音器；Draw · Input · Gallery |
| 3 | My sounds | `1:49` | 白 | 勾选 1–5 段 → Next Step |
| 4 | Transform | `1:288` | 白 | 声→笔刷魔法动画 |
| 5 | Sound Brush | `1:352` | 白 | 列表 + 预览 + Use Brush / 加色盘 |
| 6 | Canvas | `1:298` | 白 | 作画 + 5 色槽工具栏 |
| 7 | My Gallery | `1:629` | 白 | 浏览作品 |
| 8 | Gallery Select | `1:644` | 白 | 多选 + Print |
| 9 | Printing | `1:314` | 白 | 打印中动画 |

**主线：** `1 → 2 → 3 → 4 → 5 → 6`；图库支线 `7 ↔ 8 → 9`。色盘上限 **5**（与「画板最多 5 段」一致）。

---

## 7. 各屏红线表（实测坐标）

坐标为 Figma 屏内相对值（原点左上，单位 px）。

### 7.1 Splash `1:3`
| 元素 | 值 |
|------|----|
| 背景 | 全屏 `#F16E1C` |
| Logo（Piko + 黄火花） | 居中偏上；火花色 `#FDBF42`，圆点 `40×14 圆角 60` |
| Slogan | `Catch a sound. Make a world.` 居中 `top:498`，20 SemiBold `#F9F8F4` |
| 约束 | **仅** Logo + Slogan，无其他控件 |

### 7.2 Collect `1:14`
| 元素 | 值 |
|------|----|
| 标题 Collect | `(465,53)` 36 Bold 橙 |
| 主说明 | 居中 `top:131` 32 `#535353` |
| 中心磁贴 Input | `(352,242)` 350×350 圆角 100，阴影 |
| 侧磁贴 Gallery | `(759,262)` 312×312 圆角 89 opacity .8 |
| 侧磁贴 Draw | `(-17,262)` 312×312 圆角 89 opacity .8 |
| 序号角标 | 白圈 Ø27–30 + 橙数字 |
| 底部状态 | `Waiting for recorder...` 居中 `top:610` 24 `#CACACA` |

### 7.3 My sounds `1:49`
| 元素 | 值 |
|------|----|
| 标题 | `(431,53)` 36 Bold 橙 |
| 指引 | `(30,165)` `Pick 1–5 sounds to turn into brushes.` 32 `#535353` |
| 声卡 ×4 | 起始 `left:30/308/586/864`，`top:227`，219×379 圆角 30 cream 阴影 |
| 选中圈 | 卡内 `top:245` Ø30 |
| 名称 | 卡内 `top:441` 20 居中 `#535353` |
| 波形槽 | `top:476` 197×54 圆角 20 白 + inset |
| 播放钮 + 时长 | `top:548/558`；时长 16 橙 |
| 计数 | `(30,699)` `0 selected` 24 `#CACACA` |
| CTA Next Step | 右下 橙胶囊 圆角 40，白字 24 |
| 右上钮 | `(979,60)` Ø56 波形圆钮 |

### 7.4 Transform `1:288`
| 元素 | 值 |
|------|----|
| 返回钮 | `(31,60)` Ø61 |
| 标题 Transform | `(440,53)` 36 Bold 橙 |
| 副文案 | 居中 `top:148` 36 `#535353` w482 |
| 魔法球 | `(394,265)` 285×288 blur2 + glow（圈 `(343,225)` 369） |
| 状态胶囊 | `(385,594)` 302×53 圆角 60 `2px` 橙边，`Brush Blooming` 28 橙 |

### 7.5 Sound Brush `1:352`
| 元素 | 值 |
|------|----|
| 返回钮 | `(31,60)` Ø61 |
| 标题 | `(417,56)` 36 Bold 橙 |
| 左栏标题 | `(31,151)` `Your Sound Brushes` 24 `#535353` |
| 右栏标题 | `(417,151)` `Made From a Sound` 24 `#535353` |
| 笔刷行 ×N | `left:31` `top:195/333/471/609`，317×102 圆角 20 `2px` 橙边 |
| 选中行 | `top:195` 行加 cream + 阴影 |
| 信息条 | `(417,195)` 596×57 圆角 20 橙边 |
| 预览板 | `(417,273)` 596×336 圆角 20 cream |
| CTA Use Brush | `(417,644)` 橙胶囊 圆角 40，白字 24 |
| 次操作 | `(774,665)` `Add to palette: 0/5` 20 `#9A9A9A` |

### 7.6 Canvas `1:298`
| 元素 | 值 |
|------|----|
| 顶栏 | 左返回圆钮 / 中橡皮钮 + 色盘 pill（5 色 + `⋯`，pill `(367,60)` 456×61）/ 右保存钮 |
| 色块 | 5 个 58×39 圆角，起 `left:383` 间距 76 |
| 画布 | 纯白全幅 |

### 7.7 My Gallery `1:629` / Select `1:644`
| 元素 | 值 |
|------|----|
| 标题 | `(431,53)` 36 Bold 橙 |
| 返回 / 菜单钮 | `(31,60)` / `(962,60)` Ø61 |
| 卡片网格 | 3 列，卡 305×216 圆角，cream 阴影；行距 `top:187/432`，列起 `left:30/374/718` |
| 选中圈（Select） | 卡左上 Ø25 `#CACACA` |
| CTA Print | `(742,751)` 281×67 橙胶囊，`Print` 白 24 |

### 7.8 Printing `1:314`
| 元素 | 值 |
|------|----|
| 标题 Printing | `(460,53)` 36 Bold 橙 |
| 设备插画 + 出纸 | 居中 device `(272,296)` 509×384；橙 bumper |
| 大橙弧底 | `(-21,445)` Ø1095 |
| 底文案 | 居中 `top:699` `Your artwork is coming to life…` 24 |

---

## 8. 落地建议（对齐现有 `web-demo/`）

**技术栈：** 原生 HTML/CSS/JS，单页多视图（`.view` 切换），入口 `web-demo/index.html` + `style.css` + `app.js`。

**迁移步骤（灰旧主题 → 橙 Piko）：**
1. 在 `style.css` `:root` 用第 3 节 Token **替换**旧变量（保留旧变量名做别名过渡也可，但取值改为 Piko）。
2. `body` 字体族改为 `--piko-font`；引入方圆体（`@font-face` 或已装字体）。
3. 按钮/卡片基础样式改为圆角 + `--piko-shadow`；主按钮统一 `--piko-radius-cta` 橙实心。
4. 逐屏按第 7 节红线表重排（Library/Plate 现有结构映射到 Collect/My sounds/Canvas 等语义）。
5. 每屏完成后与 Figma 截图 1:1 比对。

**相关文件：**
- `web-demo/index.html`、`style.css`、`app.js`（主结构 / 视图切换）
- `sampleLibraryStore.js`（录音库 IndexedDB）
- `plateManager.js`（画板多 brush，最多 5，对应色盘上限）
- 色彩生成：`soundColorEngine.js`、`visualMapping.js`（色盘实际取色）

> 遵守跨平台规则：勿硬编码路径、勿批量格式化、勿改 `.venv`。

---

## 9. `:root` 变量草稿

```css
:root {
  --piko-orange: #f16e1c;
  --piko-yellow: #fdbf42;
  --piko-cream: #f9f8f4;
  --piko-white: #ffffff;
  --piko-text: #535353;
  --piko-muted: #cacaca;
  --piko-muted-2: #9a9a9a;

  --piko-shadow: 0 4px 4px rgba(0, 0, 0, 0.25);
  --piko-inset: inset 0 0 4px rgba(0, 0, 0, 0.25);
  --piko-border-sel: 2px solid #f16e1c;

  --piko-radius-card: 20px;
  --piko-radius-sound: 30px;
  --piko-radius-cta: 40px;
  --piko-radius-pill: 60px;
  --piko-radius-tile: 100px;
  --piko-radius-tile-sm: 89px;

  --piko-font: "Alimama FangYuanTi VF", "PingFang SC", system-ui, sans-serif;
  --piko-fs-title: 36px;
  --piko-fs-body: 24px;
  --piko-fs-hint: 24px;

  --piko-screen-w: 1055px;
  --piko-screen-h: 834px;
  --piko-gutter: 30px;
}
```

---

## 10. 验收清单

**全局**
- [ ] 主色统一 `#F16E1C`，无旧灰主题残留
- [ ] 主字体为方圆体，非 Inter/系统字体
- [ ] 页标题 36 Bold 橙
- [ ] CTA / 圆钮 / 卡片带 `0 4px 4px rgba(0,0,0,0.25)`
- [ ] 无直角卡片，圆角取本文件值
- [ ] 触控热区圆钮 ≥ 56，主 CTA 高 ≥ 53

**分屏**
- [ ] Splash 仅 Logo + Slogan
- [ ] Collect 中心磁贴大于两侧，侧贴 opacity .8
- [ ] My sounds 声卡 cream 圆角 30；选择上限 5；`0 selected` 弱灰
- [ ] Transform 球体 blur + 外 glow；Brush Blooming 为橙边胶囊
- [ ] Sound Brush 双栏；预览板 cream；`Add to palette: 0/5` 弱灰
- [ ] Canvas 色盘 5 槽 + `⋯`；三圆钮
- [ ] Gallery 3 列 cream 卡；Select 态出 Print CTA
- [ ] Printing 设备出纸 + 大橙弧底

---

*本文件由 Figma `PIKO-UI-DESIGN` 九屏实测反推。稿面更新时以 Figma 为准并回写本文件。*
