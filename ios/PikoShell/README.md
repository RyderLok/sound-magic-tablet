# PikoShell（iPad 独立运行时）

产品默认：**iPad 本机网关 + 内嵌 web-demo**，不依赖现场 Mac 跑 Python。  
**声音真源 = Supabase**（配好 anon 后）；本机 Documents 仅缓存。

## 打开工程

```bash
open ios/PikoShell/PikoShell.xcodeproj
```

1. Signing 选 Team → 真机 **iPad**  
2. Run（构建会 rsync `web-demo/` → `WebDemo/`）

## 一次配好 Supabase（必做）

1. **Supabase SQL Editor** 执行整份  
   [`python-service/supabase_sounds.sql`](../../python-service/supabase_sounds.sql)  
   （建表、建 `sounds` 桶、anon 读写删策略）
2. Dashboard → **Settings → API** 复制 **anon `public`**（不要 service_role）
3. App **Settings**：
   - URL 已预填项目地址  
   - 粘贴 anon key  
   - 点 **「测试云端读写」** → 必须显示 **OK**
4. （可选）Mac 校验：  
   `SUPABASE_ANON_KEY=... python3 python-service/verify_ipad_supabase.py`

配置成功后：

- ESP → iPad `/sounds/upload_pcm` → **写入 Supabase** + 本机缓存  
- Library `GET /sounds` → **云端列表**（含 Mac 历史）  
- `/sounds/{id}/audio` → 云端下载并缓存  

可选：复制 `Secrets.plist.example` → `Secrets.plist`（已 gitignore）预填 key。

## Qwen / SiliconFlow

Settings 填 `SILICONFLOW_API_KEY` → `POST /analyze/wav` 调 Qwen 五类。

## 独立模式

- 监听 `0.0.0.0:8001`  
- 打开 `http://127.0.0.1:8001/?api=http://127.0.0.1:8001`  
- Settings 显示 **ESP 上传地址** → 写入 `WIFI_UPLOAD_HOST`

| 方法 | 路径 |
|------|------|
| GET | `/health` · `/supabase/selftest` |
| POST | `/sounds/upload_pcm` · `/analyze/wav` |
| GET | `/sounds` · `/sounds/{id}/audio` |
| — | ESP announce / metrics 代理 · 静态 WebDemo |

## 开发回退

关闭「本机网关」可连 Mac `:8000/:8001`。Mac Python + service_role **未改**。
