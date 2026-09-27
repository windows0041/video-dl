# 视频下载器(本地版)

双击 **`启动视频下载器.bat`** → 自动打开浏览器 → 粘贴链接和 Cookie → 点"开始下载"。

## 使用步骤

1. **双击** `启动视频下载器.bat`(会弹出一个命令行窗口 + 打开浏览器页面)
2. 在页面上:
   - **视频链接**:一行一个,支持 B 站、抖音、YouTube 等绝大多数网站(支持分享短链)
   - **Cookie**(可选):B 站想下最高画质就必填。获取方法见下
   - **清晰度**:默认"最高画质"
   - **代理**(可选):开了 Clash/V2Ray 等代理工具时填,如 `http://127.0.0.1:7890`
3. 点 **⬇ 开始下载**,下方日志会实时滚动
4. 完成后在"已下载的文件"列表点 **保存**,或直接点 **打开下载文件夹** 拿文件

文件都保存在本文件夹的 **`downloads\`** 里,命名格式:`视频标题 [BV号].mp4`

## Docker 部署(推荐长期运行 / 服务器 / NAS)

前提:装了 Docker(Windows 用 Docker Desktop,Linux 用原生 Docker)。

```bash
cd video-dl
docker compose up -d --build     # 首次:构建镜像 + 后台启动
```

然后浏览器打开 **`http://<主机IP>:8734`**(本机就是 `http://127.0.0.1:8734`)。

| 操作 | 命令 |
|---|---|
| 停止 | `docker compose down` |
| 查看日志 | `docker compose logs -f` |
| 更新(新版 yt-dlp / 代码) | `docker compose up -d --build` |
| 换端口 | 改 `docker-compose.yml` 里 `ports` 左边,如 `9000:8734` |
| 进容器 | `docker exec -it video-dl sh` |

- 下载的文件持久化在 **本目录 `downloads\`**(挂卷),重建镜像不丢
- 镜像里自带 ffmpeg + python3 + yt-dlp(每次 `--build` 装最新版 yt-dlp),**不需要** `tools\` 里的 Windows 版
- Docker 里"读取 Edge 浏览器 Cookie"一般用不上(容器里没有你的浏览器),直接粘贴 Cookie 最稳
- 局域网其他设备(手机等)也能访问 `http://<主机IP>:8734`,边下边刷

## Linux 直接运行(不用 Docker)

```bash
# 依赖
sudo apt install nodejs ffmpeg python3-pip   # Debian/Ubuntu
pip3 install yt-dlp                          # 或把 yt-dlp/ffmpeg 放进 tools\ 也行
chmod +x start.sh && ./start.sh
```

`server.mjs` 跨平台:Linux 下自动用系统 PATH 里的 `yt-dlp`/`ffmpeg`,`tools/` 里的同名的话优先用本地版。

## Cookie 怎么拿(以 B 站为例)

1. Edge 打开 bilibili.com 并登录
2. F12 → **网络** 标签 → F5 刷新 → 点第一个请求
3. 请求标头里找到 `Cookie:` → 右键复制值,整串粘到页面里
4. 页面会自动记住你上次填的 Cookie(存在浏览器 localStorage 里)

> 不想复制?勾选页面上的"直接读取 Edge 浏览器里的 Cookie"也行(需 Edge 已登录)。
> Cookie 相当于登录密码,别发群里;B 站 SESSDATA 默认 30 天过期。

## 目录结构

```
video-dl\
├─ 启动视频下载器.bat   ← 双击这个
├─ server.mjs           ← 服务器代码(想改端口就改里面的 PORT)
├─ public\index.html    ← 网页界面
├─ tools\
│  ├─ yt-dlp.exe        ← 下载引擎
│  └─ ffmpeg.exe        ← 音视频合并
├─ downloads\           ← 下载的文件都在这
└─ tmp\                 ← 临时文件
```

## 常见问题

| 问题 | 处理 |
|---|---|
| 页面一直转圈/显示"断开" | 确认命令行窗口还开着;窗口标题"视频下载器" |
| 端口被占用 | 之前开过的窗口没关,找到关掉即可(程序会自动复用) |
| 提示"工具缺失" | 把 `yt-dlp.exe` / `ffmpeg.exe` 放回 `tools\` 文件夹 |
| 下载慢 | 正常现象,看日志里的速度;B 站 1080p 约 500KB/s |
| 日志报"连接被拒绝/10061" | 当前 B 站 CDN 节点或端口不通。①直接再点一次下载(会换节点) ②换低一档清晰度 ③有代理就填代理地址 |
| 某网站下不了 | 日志里会有具体报错;可到 https://github.com/yt-dlp/yt-dlp 看该站点支持情况 |
| 想升级 yt-dlp | 到 https://github.com/yt-dlp/yt-dlp/releases 下载最新 `yt-dlp.exe` 覆盖 `tools\yt-dlp.exe` |

## 停止/关闭

- 停止当前下载:页面"■ 停止"按钮
- 关闭整个程序:页面"关闭服务器"按钮,或直接关掉那个命令行窗口
