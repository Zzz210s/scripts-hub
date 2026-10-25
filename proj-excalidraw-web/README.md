# Excalidraw 前端补丁:服务器存储面板

在**上游自己的源码**上注入一个面板,让自建实例能把图存到服务器目录树,也能从目录树打开、或一键下载到本地。

## 为什么是"补丁"而不是 fork

上游 `excalidraw-app` 迭代很快,整包 fork 会持续冲突。这里只在 `excalidraw-app/App.tsx` 里插两处:

- 一行 `import { ServerStorage } from "./components/ServerStorage";`
- 一行 `<ServerStorage excalidrawAPI={excalidrawAPI} />`(放在 `<Excalidraw .../>` 之前)

`patch.mjs` 用**锚点**定位这两处;锚点找不到就**直接让构建失败**,不会静默产出一个没有面板的镜像。

## 文件

| 文件 | 作用 |
|---|---|
| `ServerStorage.tsx` | 面板本体:目录树浏览、保存、打开、下载、冲突提示、Ctrl+S、令牌输入 |
| `serverStorageApi.ts` | HTTP 客户端与纯函数(`call`、`withSuffix`、`serializeScene`…) |
| `storageList.tsx` | 列表与样式 |
| `serverStorageHooks.ts` | `useCtrlSOpen`、`useAutoTokenPrompt` |
| `patch.mjs` | 注入脚本(`--check` 只检查锚点) |
| `nginx.conf` | 前端 nginx:`/api` 反代到 `storage:9100`,静态资源长缓存 |
| `Dockerfile` | 拷贝上游源码 + 本目录 → 注入 → `yarn build:app:docker` |
| `e2e.mjs` | 用 CDP 驱动无头 Chrome 真点一遍(保存 / 刷新后打开),8 项断言 |

## 交互

- 右下角「服务器存储」按钮;`Ctrl/Cmd+S` 直接开保存面板
- 首次使用弹一次令牌输入,存浏览器 localStorage(键 `exc-server-token`)
- 保存会带上"上次读到的版本";服务器上已被人改过时提示「覆盖 / 另存」
- 「下载到本地」走浏览器下载,不经过服务器

## 验证

单测在存储服务那边(`proj-excalidraw-storage`);这里是端到端:

```bash
# 1) 隧道 + 无头 Chrome
ssh -f -N -L 8082:127.0.0.1:8082 <服务器>
chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/exc about:blank
# 2) 跑断言
EXC_TOKEN=$(ssh <服务器> 'sudo cat /srv/apps/excalidraw/token.txt') node e2e.mjs
```

只依赖 Node 22+ 内置的 `WebSocket`,不装任何包。
