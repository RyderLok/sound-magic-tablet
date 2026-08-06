# iPad / Xcode 交接清单

> 用户状态（2026-08-07）：SQL 已跑；真机已装；开发者已信任；Supabase 用户已配置。

## 已完成

- [x] Supabase SQL Editor 执行 `python-service/supabase_sounds.sql`
- [x] Mac Python + `service_role` 上传路径保持可用
- [x] iPad 工程：`LocalPikoGateway`、Supabase anon、内嵌 web-demo
- [x] `DEVELOPMENT_TEAM = 563664W9FK`；真机包 BUILD SUCCEEDED
- [x] 安装到 **Ryder’s ipad**（iPad Air 5）；App 可启动
- [x] Settings 配 Supabase（用户确认）

## 待完成

1. [x] ESP 上传地址：`http://172.20.10.3:8001`
2. [x] 已写入 `esp32/wifi_secrets.h` → `WIFI_UPLOAD_HOST "172.20.10.3"`
3. [ ] Arduino 烧录 `esp32/inmp441_bridge.ino`（含 wifi_secrets.h）
4. [ ] 闭环：手机热点(2.4G) + ESP + iPad（Mac 可不跑 Python）
   - 按键录音 → Library 出现且能播
   - 能看到云端历史录音

## 可选

- [ ] `SUPABASE_ANON_KEY=… python3 python-service/verify_ipad_supabase.py`
- [ ] Settings 填 SiliconFlow API Key

## 文档

- [`README.md`](./README.md) · [`Piko中文交互说明与iPad就绪.md`](../../Piko中文交互说明与iPad就绪.md) · [`交互基准.md`](../../交互基准.md)
