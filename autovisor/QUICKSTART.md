# QUICKSTART — autovisor

用 Autovisor 自动播放智慧树 / 知到的共享课视频。**本目录只有配置**,程序本体是上游发布的
Windows 打包程序(体积与二进制形态不适合进仓库)。

## 前置条件

- Windows + 本机标准路径的 Chrome(或 Edge)
- 从上游 release 下载的 Autovisor v3.17.3 zip:<https://github.com/CXRunfree/Autovisor/releases>
- 不需要 Python、不需要 npm、不需要凭据文件

## 三条命令

没有可执行的构建或测试(这里没有自研代码),只有检查与复制:

```bash
bash scripts/setup-autovisor.sh                 # 在仓库根:检查配置与课程链接
# 1. 解压上游 zip 到 %AUTOVISOR_DIR%\app
# 2. 复制 autovisor/configs.ini 到 app\ 覆盖同名文件
# 3. 运行 app\Autovisor.exe,打开浏览器后手动登录一次
```

## 需要填的凭据

不需要。`configs.ini` 的 `username` / `password` 留空,运行时手动登录一次,登录态落在
`app\data\cookies.json`(不要把它复制进仓库)。

## 怎么验证跑通了

1. `bash scripts/setup-autovisor.sh` 报告「配置可用」
2. `configs.ini` 的 `[course-url]` 至少一条 `studyvideoh5.zhihuishu.com/stuStudy?...` 链接
3. 双击 `Autovisor.exe` 后浏览器打开并开始播放,实时日志写在 `app\logs\LogN.txt`(UTF-8)

## 常见失败

| 现象 | 处置 |
| --- | --- |
| 启动后直接退出 | `[course-url]` 没有有效链接;补一条共享课播放页 |
| 永久卡在「正在加载播放页」 | 用了新版 `studywisdomh5.zhihuishu.com` 域名,不支持;换回 `studyvideoh5` |
| 每次启动刷「不是有效网址」 | 有多余的空 `URLn` 行;只保留实际链接 |
| exe 被杀软删掉 | PyInstaller 打包的 exe 易被误杀;从 `%AUTOVISOR_DIR%` 的 zip 重新解压 |
| 换了浏览器要不要重新登录 | 不用;登录态在 `data\cookies.json`,不在浏览器里 |
