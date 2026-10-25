# Excalidraw 服务端存储

只做文件系统的极简 REST 服务:场景存成真实目录树下的 `.excalidraw` 文件,供自建 Excalidraw 前端读写。

| 接口 | 作用 |
|---|---|
| `GET /api/tree` | 整棵目录树(目录 + 文件,含大小/mtime/版本指纹) |
| `GET /api/scene?path=...` | 读一个场景(返回 `{scene, version}`) |
| `PUT /api/scene?path=...` | 保存 `{scene, baseVersion?}`;`baseVersion` 不匹配回 409(防静默覆盖) |
| `POST /api/folder` | `{path}` 建目录(可建多级) |
| `DELETE /api/item?path=...` | 删文件或空目录(非空回 409) |
| `GET /health` | 存活 + 文件数(不需要令牌) |

## 约定

- 根目录 `ROOT`(默认 `/data/scenes`),一切路径都相对它,越界/绝对路径/非 `.excalidraw` 一律 400
- 鉴权:除 `/health` 外都要 `Authorization: Bearer <token>`;令牌优先从 `RELAY_TOKEN_FILE` 读(600 的文件,便于轮换),否则用 `RELAY_TOKEN` 环境变量。没配令牌 = 不鉴权,别这么跑
- 版本指纹 = `大小-mtime(毫秒)`;保存带 `baseVersion` 时不一致就 409,前端据此提示「覆盖 / 另存」
- 请求体上限 `MAX_BODY_MB`(默认 32),超了回 413 而不是掐断连接

## 测试

```bash
node --test test/storage.test.mjs   # 11 个用例:路径穿越、目录树、冲突、鉴权、删除、坏文件、上限
```

## 部署

服务器上由 `/srv/apps/excalidraw/compose.yaml` 的 `storage` 服务托管(镜像 `excalidraw-storage:local`),
前端 nginx 把 `/api` 反代到它,浏览器同源,不用处理 CORS。
