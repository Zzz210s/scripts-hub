import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { runConsole, buildConsoleEnv, assertNoSinks, ConfigError, RUN_TASKS } from '../src/console-runner.js'
import { loadConfig } from '../src/config.js'

const fakeSpawn = (script = {}, record = {}) => (cmd, args, options) => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => { child.killed = true; setImmediate(() => child.emit('close', null)) }
    record.cmd = cmd
    record.args = args
    record.options = options
    setImmediate(() => {
        if (script.stdout) child.stdout.emit('data', script.stdout)
        if (script.stderr) child.stderr.emit('data', script.stderr)
        if (!script.hang) child.emit('close', script.code ?? 0)
    })
    return child
}

test('开关矩阵逐条正确(设计文档 §6.2/§6.3)', () => {
    const cfg = loadConfig({})
    const env = buildConsoleEnv(cfg, { coinTarget: { target: 3 } })
    const expected = {
        Ray_RunTasks: 'Daily&VipBigPoint&Manga&MangaPrivilege',
        Ray_DailyTaskConfig__IsEnable: 'true',
        Ray_VipBigPointConfig__IsEnable: 'true',
        Ray_MangaTaskConfig__IsEnable: 'true',
        Ray_MangaPrivilegeTaskConfig__IsEnable: 'true',
        Ray_VipPrivilegeConfig__IsEnable: 'false',
        Ray_ChargeTaskConfig__IsEnable: 'false',
        Ray_Silver2CoinTaskConfig__IsEnable: 'false',
        Ray_UnfollowBatchedTaskConfig__IsEnable: 'false',
        Ray_LiveFansMedalTaskConfig__IsEnable: 'false',
        Ray_LiveLotteryTaskConfig__IsEnable: 'false',
        Ray_DailyTaskConfig__IsWatchVideo: 'true',
        Ray_DailyTaskConfig__IsShareVideo: 'true',
        Ray_DailyTaskConfig__SelectLike: 'false',
        Ray_DailyTaskConfig__NumberOfCoins: '3',
        Ray_DailyTaskConfig__NumberOfProtectedCoins: '20',
        Ray_DailyTaskConfig__SupportUpIds: '',
        Ray_Security__RandomSleepMaxMin: '0',
        // 上游默认间隔 20 秒会让请求前的随机睡眠(10-20 秒)计入 30 秒超时预算 → 分享流程超时
        Ray_Security__IntervalSecondsBetweenRequestApi: '10',
        Ray_AutoRecoverConfig__IsEnable: 'false',
        // R1:上游 CookieTaskGuard 的 nav 15 秒超时会静默跳过整次任务且退出码仍为 0
        Ray_CookieCheck__AutoCheckEnabled: 'false'
    }
    for (const [key, value] of Object.entries(expected)) assert.equal(env[key], value, key)
    assert.equal(Object.keys(env).length, Object.keys(expected).length)
    assert.equal(RUN_TASKS, 'Daily&VipBigPoint&Manga&MangaPrivilege')
    assert.ok(!Object.keys(env).some((key) => /Serilog__WriteTo/i.test(key)))
})

test('R1:显式关掉 Console 内部登录态检查(它超时会静默跳过整次运行)', () => {
    const cfg = loadConfig({})
    const env = buildConsoleEnv(cfg, { coinTarget: { target: 3 } })
    assert.equal(env.Ray_CookieCheck__AutoCheckEnabled, 'false')
    assert.ok(Object.keys(env).includes('Ray_CookieCheck__AutoCheckEnabled'))
})

test('spawn 参数:dotnet + consoleDll + cwd=consoleDir,stdout 逐行回调', async () => {
    const record = {}
    const cfg = loadConfig({ BILIBILI_CONSOLE_DIR: '/app', BILIBILI_CONSOLE_DLL: '/app/Ray.BiliBiliTool.Console.dll' })
    const lines = []
    const result = await runConsole(RUN_TASKS, { EXTRA: '1' }, { config: cfg, spawnImpl: fakeSpawn({ stdout: 'line1\nline2\n' }, record), onLine: (line) => lines.push(line) })
    assert.equal(result.code, 0)
    assert.ok(result.stdout.includes('line1'))
    assert.equal(record.cmd, 'dotnet')
    assert.deepEqual(record.args, ['/app/Ray.BiliBiliTool.Console.dll'])
    assert.equal(record.options.cwd, '/app')
    assert.equal(record.options.env.Ray_RunTasks, RUN_TASKS)
    assert.equal(record.options.env.EXTRA, '1')
    assert.deepEqual(lines, ['line1', 'line2'])
})

test('非空 Serilog__WriteTo* -> 抛 config-invalid', () => {
    assert.throws(() => assertNoSinks({ Serilog__WriteTo__0__Name: 'Console' }), (error) => error.code === 'config-invalid')
    assert.throws(() => assertNoSinks({ Ray_Serilog__WriteTo__1__Name: 'File' }), ConfigError)
    assert.doesNotThrow(() => assertNoSinks({ Serilog__WriteTo__0__Name: '' }))
    assert.doesNotThrow(() => assertNoSinks({}))
    assert.throws(() => runConsole(RUN_TASKS, { Serilog__WriteTo__0__Name: 'Console' }, { spawnImpl: () => { throw new Error('不应 spawn') } }), ConfigError)
})

test('超时被杀 -> timedOut', async () => {
    const cfg = loadConfig({ BILIBILI_CONSOLE_TIMEOUT_MINUTES: '1' })
    const result = await runConsole(RUN_TASKS, {}, { config: cfg, timeoutMinutes: 0.00001, spawnImpl: fakeSpawn({ hang: true }) })
    assert.equal(result.timedOut, true)
    assert.equal(result.code, null)
})

test('spawn 报错 -> error,不抛', async () => {
    const spawnImpl = () => { const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {}; setImmediate(() => child.emit('error', new Error('ENOENT'))); return child }
    const result = await runConsole(RUN_TASKS, {}, { spawnImpl })
    assert.equal(result.error, 'ENOENT')
})

// 请求间隔可调:2026-10-28 实测 2.5-5 秒的节奏让 /x/web-interface/view 在机房 IP 上吃到 -412,
// 默认放宽到 10 秒;要覆盖就用 BILIBILI_INTERVAL_SECONDS。
test('请求间隔默认 10 秒且可用环境变量覆盖', () => {
    assert.equal(loadConfig({}).intervalSeconds, 10)
    assert.equal(loadConfig({ BILIBILI_INTERVAL_SECONDS: '18' }).intervalSeconds, 18)
    const env = buildConsoleEnv(loadConfig({ BILIBILI_INTERVAL_SECONDS: '18' }), { coinTarget: { target: 5 } })
    assert.equal(env.Ray_Security__IntervalSecondsBetweenRequestApi, '18')
})
