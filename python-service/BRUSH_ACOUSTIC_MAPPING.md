# 声音 → 笔刷：类别 vs 类内差异

## 职责拆分

| 来源 | 决定什么 | 不决定什么 |
|------|----------|------------|
| **Qwen** (`siliconflow_omni.py`) | 五类之一 → `strokePattern` | 不改 `brushParams` 数值 |
| **本地声学** (`acoustic_features.py`) | `acousticFeatures` 0–1 | 不分类别 |
| **映射** (`brush_mapper.py`) | 类内 `brushParams`（限 `BRUSH_RANGES`） | 不换笔刷算法 |

```
Qwen category ──► strokePattern (五套 BrushGenerator 之一)
本地 acousticFeatures ──► 在该类别 BRUSH_RANGES 内偏移 brushParams
```

## 类别 → 算法

| category | strokePattern |
|----------|---------------|
| birds | scatter_points |
| wind_leaves | flow_field |
| water | wave_ripple |
| material_impact | impact_burst |
| insects_amphibians | pulse_grid |

## 声学特征 → 视觉轴

| 轴 | 输入特征 | 主要输出参数 |
|----|----------|--------------|
| 音量 / 尺度 | rms, peak, bassRatio | brushSize, radius, strokeWidth, expansion |
| 频率 / 细节 | spectralCentroid, bass/mid/treble | particleSize, detailScale, localMotion, edgeSharpness |
| 粗糙度 | roughness, spectralFlatness, spectralFlux | turbulence, jitter, edgeNoise, deformation*, smoothness↓ |
| 节奏 | tempo, onsetDensity, pulseRegularity | pulseRate, spawnRate, spacing, rhythmStrength |
| 连续性 | continuity, silenceRatio, eventDuration | trailLength, connectionStrength, gapProbability, strokePersistence |
| 震动（复合） | rough×0.45 + flux×0.30 + rms×0.15 + onset×0.10 | vibrationAmplitude / Frequency / Randomness |

\* `deformationSpeed` 跟 `spectralFlux`，不改基础造型。

## 统一输出

见 `analysisExport.unifiedBrush` / 响应顶层字段：

```json
{
  "category": "birds",
  "strokePattern": "scatter_points",
  "acousticFeatures": { "rms": 0.62, "...": "..." },
  "brushParams": { "brushSize": 0.48, "vibrationAmplitude": 0.47, "...": "..." }
}
```

## 关键文件

| 文件 | 角色 |
|------|------|
| `acoustic_features.py` | 特征提取 + 归一化 |
| `brush_mapper.py` | 类别范围 + 映射 |
| `analysis_export.py` | Mode B 导出（无本地定类） |
| `audio_analyzer.py` | WAV 管线入口 |
| `app.py` | Qwen 后注入 category 再映射 |
| `web-demo/brushGenerator.js` | 五套算法读新参数 |
| `web-demo/naturalSoundArchetypes.js` | 仅用 Qwen 定 `strokePattern` |
