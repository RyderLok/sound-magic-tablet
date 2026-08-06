# iPad / Xcode 交接清单（SQL 已完成，待真机）

> 用户状态（2026-08-07）：`supabase_sounds.sql` **已在 SQL Editor 跑过**。  
> Xcode 真机安装 / Settings 配 key / 云端自测 / ESP 指向 iPad **尚未做**。  
> 新会话说「Xcode 装好了，帮我完成清单」→ 按下面执行并勾掉。

## 已完成

- [x] Supabase SQL Editor 执行 [`python-service/supabase_sounds.sql`](../../python-service/supabase_sounds.sql)
- [x] Mac Python + `service_role` 上传路径保持可用（勿破坏）
- [x] iPad 工程代码：`LocalPikoGateway`、Supabase anon 上传/列表/自测、内嵌 web-demo

## 本机已就绪（2026-08-07 会话）

- [x] `DEVELOPMENT_TEAM = 563664W9FK`（Ryder Lok）
- [x] Simulator / generic iOS **BUILD SUCCEEDED**（含 Sync WebDemo）
- [x] Xcode 已打开工程
- [ ] **阻塞**：两台 iPad 仍 Offline（`RyderLok` / `Ryder’s ipad`）——需 USB 连接并「信任此电脑」

## 待 Xcode 真机后完成

1. [ ] 选设备 **Ryder’s ipad**（或 RyderLok）→ Run（⌘R） 
2. [ ] App Settings → Supabase：
   - URL：`https://vfyzxhzpdlxnrugqomda.supabase.co`（一般已预填）
   - 粘贴 Dashboard → **API → anon `public`**（**禁止** `service_role`）
   - bucket：`sounds`
3. [ ] 点 **「测试云端读写」** → 必须显示 **OK**  
   - 失败则看提示；常见：贴错 key，或 SQL 未生效（可再跑一遍 sql）
4. [ ] Settings 复制 **ESP 上传地址**（iPad 热点 IP:8001）  
   - 写入 `esp32/wifi_secrets.h` 的 `WIFI_UPLOAD_HOST` → 重新烧录  
5. [ ] 闭环验收（只开热点 + ESP + iPad，Mac 可不跑 Python）：
   - 按键录音 → 上传成功  
   - Library 出现新条（`esp32-wifi`）且能播  
   - 能看到此前 Mac 上传到 Supabase 的历史录音  

## 可选

- [ ] Mac 校验：`SUPABASE_ANON_KEY=… python3 python-service/verify_ipad_supabase.py`
- [ ] Settings 填 SiliconFlow API Key → 验证 `/analyze/wav` / 画板语义

## 文档入口

- [`ios/PikoShell/README.md`](./README.md)
- [`Piko中文交互说明与iPad就绪.md`](../../Piko中文交互说明与iPad就绪.md)
- [`交互基准.md`](../../交互基准.md)
