# 智慧树刷课(Autovisor 配置)

用 Autovisor 自动播放智慧树 / 知到的共享课视频。本目录只有**配置**,程序本体是上游打包好的 exe。

| | |
| --- | --- |
| 程序本体 | 上游 [`CXRunfree/Autovisor`](https://github.com/CXRunfree/Autovisor) v3.17.3(MIT);代码未改,只改配置 |
| 装在哪 | `%AUTOVISOR_DIR%\app`(原始 zip 备份留在 `%AUTOVISOR_DIR%`) |
| 跑在哪台机器 | **只在本机 Windows** —— 需要本机 Chrome 与图形会话 |
| 什么时候跑 | 手动运行 `Autovisor.exe`,没有计划任务 |

## 本目录有什么

- `configs.ini`:实际使用的配置,含课程链接;**账号密码留空**,不存凭据。

## 依赖

- 本机标准路径的 Chrome(Playwright 用 `channel="chrome"`,不依赖内置浏览器)
- 程序本体自带 Python 3.10 与 Playwright(PyInstaller 打包),无需另行安装

## 需要哪些凭据

不需要。`configs.ini` 的 `username` / `password` 留空,运行时手动登录一次,登录态落在
`app\data\cookies.json`。详见 `../docs/credentials.md`。

## 通知

不接企业微信。只有程序自己的界面与 `app\logs\LogN.txt`。

## 配置项(当前值)

| 项 | 值 | 说明 |
| --- | --- | --- |
| `driver` | `Chrome` | Playwright 走 `channel="chrome"`,用本机标准路径的 Chrome;`EXE_PATH` 留空即可 |
| `limitMaxTime` | `0` | 不限制刷课时长(刷完整门课) |
| `limitSpeed` | `1.8` | 播放倍速上限 |
| `enableAutoCaptcha` | `True` | 自动过登录滑块 |
| `soundOff` | `True` | 静音 |
| `showDonateCode` | `False` | 关掉赞赏码弹窗 |
| `username` / `password` | 留空 | 留空则打开浏览器后手动登录;登录态存在 `app\data\cookies.json` |
| `[course-url]` | 至少一条 | **必须填**,否则启动即报「未检测到有效网址」直接退出(浏览器不会打开) |

## 课程链接格式

当前只支持**共享课播放页**:

```
https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=<课程ID>
```

**新版课程页 `studywisdomh5.zhihuishu.com/study/index?...` 不被支持** —— 实测会永久卡在「正在加载
播放页」:源码 `modules/utils.py` 的 `optimize_page` 调 `evaluate_js(page, ".studytime-div", ...)` 时
`timeout=None`,而该页面没有这个元素,Playwright 默认等待 24 小时。上游 issue #130 报的就是这个域名
(已关闭但无修复提交)。

## 日志

- 实时日志:`%AUTOVISOR_DIR%\app\logs\LogN.txt`(**UTF-8**,实时写),排错看这个。
- 重定向 stdout 得到的是 GBK,且进度条会把文件撑到数 MB —— 不要用它排错。

## 常见问题

| 现象 | 原因 | 处置 |
| --- | --- | --- |
| 启动后直接退出 | `[course-url]` 没有有效链接 | 补一条共享课播放页链接 |
| 永久卡在「正在加载播放页」 | 用了新版课程页域名 | 换成 `studyvideoh5.zhihuishu.com/stuStudy?...` 格式 |
| exe 被杀软删掉 | PyInstaller 打包的 exe 易被误杀 | 用 `%AUTOVISOR_DIR%` 里的 zip 重新解压 |
| 每次启动刷「不是有效网址」警告 | 有多余的空 `URLn` 行 | 只保留实际链接,删掉多余空行 |
| 换了浏览器要重新登录吗 | 登录态在 `data\cookies.json`,不在浏览器里 | 不用;改 `driver` 后直接跑 |

## 换浏览器 / 换课程

- 换浏览器:改 `configs.ini` 的 `driver`(Edge / Chrome)。
- 换课程:改 `[course-url]` 下的 `URL1`、`URL2`…(可多条,按顺序刷)。

## 升级

从上游 release 下载新 zip → 解压覆盖 `%AUTOVISOR_DIR%\app`(保留 `data\cookies.json` 与
`configs.ini`)。

## 相关文档

- 全貌与调度位置:`../docs/automation-overview.md`
- 凭据:`../docs/credentials.md`
