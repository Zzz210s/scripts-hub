# 智慧树刷课(配置方案)

程序本体:Autovisor v3.17.3(`github.com/CXRunfree/Autovisor`,MIT,Playwright + 内嵌 Python 3.10)
位置:`%AUTOVISOR_DIR%\app`(原始 zip 备份在 `%AUTOVISOR_DIR%`)

> 路径约定:`%AUTOVISOR_DIR%` 指 Autovisor 的安装目录,详见仓库根 README。

## 本目录内容

- `configs.ini`:实际使用的配置(含课程链接;**账号密码留空**,不存凭据)

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
| `[course-url]` | 至少一条 | **必须填**,否则启动即报"未检测到有效网址"直接退出(浏览器不会打开) |

## 课程链接格式

当前只支持**共享课播放页**:

```
https://studyvideoh5.zhihuishu.com/stuStudy?recruitAndCourseId=<课程ID>
```

**新版课程页 `studywisdomh5.zhihuishu.com/study/index?...` 不被支持** —— 实测会永久卡在"正在加载播放页":
源码 `modules/utils.py` 的 `optimize_page` 调 `evaluate_js(page, ".studytime-div", ...)` 时 `timeout=None`,
而该页面没有这个元素,Playwright 默认等待 24 小时。上游 issue #130 报的就是这个域名(已关闭但无修复提交)。

## 日志

- 实时日志:`%AUTOVISOR_DIR%\app\logs\LogN.txt`(**UTF-8**,实时写),排错看这个
- 重定向 stdout 得到的是 GBK,且进度条会把文件撑到数 MB —— 不要用它排错

## 换浏览器 / 换课程

- 换浏览器:改 `configs.ini` 的 `driver`(Edge / Chrome)。登录态在 `data\cookies.json`,换浏览器不用重新登录
- 换课程:改 `[course-url]` 下的 `URL1`、`URL2`…(可多条,按顺序刷)
- 只保留一条链接时,把多余的空 `URLn` 删掉,否则每次启动会刷几行"不是有效网址"的警告

## 升级

从上游 release 下载新 zip → 解压覆盖 `%AUTOVISOR_DIR%\app`(保留 `data\cookies.json` 与 `configs.ini`)。
PyInstaller 打包的 exe 易被杀软误杀,误杀后直接用 `%AUTOVISOR_DIR%` 里的 zip 重新解压即可。
