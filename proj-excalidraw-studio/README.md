# 自建白板(Excalidraw 薄壳)

官方 `@excalidraw/excalidraw` 组件 + 一层很薄的壳:存到服务器目录树 / 从目录树打开 / 本地文件 / 本地草稿。

**不修改上游源码** —— 这是本项目和"打补丁"路线的根本区别:

| | 打补丁路线(已废弃) | 本项目 |
|---|---|---|
| 上游升级 | 要在 `App.tsx` 里追两个锚点,锚点变了就构建失败;每次重建 7 分钟 | 改 `package.json` 里 `@excalidraw/excalidraw` 的版本号后重建,1-2 分钟 |
| 依赖 | 上游整包源码(58MB)+ yarn 全量依赖 | 一个 npm 依赖 + vite |

## 功能

- **服务器存储**:右下角面板,可浏览/新建文件夹、保存、打开;`Ctrl/Cmd+S` 开保存面板
- **防覆盖**:保存带"上次读到的版本",服务器上已被人改过就提示「覆盖 / 另存」
- **保存到本地**:HTTPS 下弹系统"另存为"对话框(可选文件夹);HTTP 下退回下载到下载目录
- **打开本地文件**、**本地草稿**(浏览器 localStorage,防误刷新丢图)

## 目录

| 文件 | 作用 |
|---|---|
| `src/App.tsx` | 壳:挂载官方组件、底部按钮、自动草稿 |
| `src/localFile.ts` | 本地保存(`showSaveFilePicker` + 下载兜底)、打开本地文件 |
| `src/storage/panel.tsx` | 服务器存储面板 |
| `src/storage/api.ts` | HTTP 客户端与纯函数 |
| `src/storage/list.tsx` / `hooks.ts` | 列表渲染 / 快捷键与令牌提示 |
| `public/sw.js` | 注销旧官方 app 留下的 Service Worker 并清缓存 |
| `nginx.conf` | 静态托管 + `/api` 反代到 `storage:9100` |
| `e2e.mjs` | CDP 驱动的端到端自检(11 项) |

## 本地开发

```bash
npm install
npm run dev     # 需要把 /api 指到存储服务:见 vite.config.ts 注释
```

## 端到端自检

```bash
ssh -f -N -L 8082:127.0.0.1:8082 <服务器>
chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/exc about:blank
EXC_TOKEN=$(ssh <服务器> 'sudo cat /srv/apps/excalidraw/token.txt') node e2e.mjs
```

11 项断言:壳已加载、画布渲染、面板可开、API 写入、文件名可填、保存成功提示、面板自动关闭、
打开的内容真的进编辑器、本地保存按钮、文件选择器与安全上下文一致。只用 Node 22+ 内置 `WebSocket`。
