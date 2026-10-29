// 宿主侧运行器骨架:六个程序共用 run-lib.sh。这里锁住「六个 run.sh 都真的用了它」,
// 以及两个曾经踩过的坑不再回归 —— 单文件里改回旧写法会立刻红。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const REPO = path.resolve(import.meta.dirname, '..', '..')
const LINUX = path.join(REPO, 'scripts', 'linux')
const PROGRAMS = ['rewards', 'weread', 'epic', 'bilibili', 'tieba', 'netease']
const read = (rel) => fs.readFileSync(path.join(LINUX, rel), 'utf8')

test('run-lib.sh 存在,并保留两个踩过的坑的修法', () => {
    const lib = read('run-lib.sh')
    // 一次性容器等 stdin 会把调用方挂住(2026-10-28 实测:ssh 手动跑挂 15 分钟)
    assert.match(lib, /run --rm -T "\$PROG_SERVICE" "\$@" <\/dev\/null/, '缺 </dev/null')
    // 看门狗先杀 sleep 再杀子 shell,否则留下 PPID=1 的孤儿
    assert.match(lib, /pkill -P "\$wdpid"/, '缺 pkill -P')
    // 锁 fd 不能被子进程继承;而且必须是**不带引号**的 `9>&-`:
    // 带引号时 bash 会把它当普通参数传给 docker compose,容器里就变成 `node src/cli.js 9>&-`
    // → 打印用法、退出码 2 —— 2026-10-29 六个程序 08:00 与 12:00 全部因此失败。
    assert.match(lib, /2>&1 9>&- &/, '锁 fd 关闭必须是字面量重定向,不能被引号包成参数')
    assert.doesNotMatch(lib, /"\$\{[A-Z_]+\}>&-"/, '锁 fd 关闭被引号包成参数了(会把 9>&- 传进容器)')
    // 兜底提醒的判据:非 0 且没有 [完成]
    assert.match(lib, /grep -q "\\\[完成\\\]"/, '缺 [完成] 判据')
})

test('五个同形 run.sh 都走共用骨架,不再各抄一份', () => {
    for (const prog of PROGRAMS.filter((p) => p !== 'rewards')) {
        const body = read(`${prog}/run.sh`)
        assert.match(body, /\. "\$SUITE_DIR\/run-lib\.sh"/, `${prog} 没有 source run-lib.sh`)
        assert.match(body, /run_program "\$@"/, `${prog} 没有调 run_program`)
        // 骨架里的东西不该再回到单个 run.sh 里
        assert.doesNotMatch(body, /docker compose/, `${prog} 自己又写了 docker compose`)
        assert.doesNotMatch(body, /flock -n/, `${prog} 自己又写了 flock`)
        assert.ok(body.split('\n').length <= 25, `${prog}/run.sh 又变长(>25 行),是不是把骨架抄回来了`)
    }
})

test('run.sh 里声明的服务名都在 compose.yaml 里', () => {
    const compose = read('compose.yaml')
    for (const prog of PROGRAMS) {
        const service = new RegExp(`PROG_SERVICE="([a-z-]+)"`).exec(read(`${prog}/run.sh`))?.[1]
        assert.ok(service, `${prog}/run.sh 没声明 PROG_SERVICE`)
        assert.match(compose, new RegExp(`^  ${service}:`, 'm'), `compose.yaml 里没有服务 ${service}`)
    }
})
