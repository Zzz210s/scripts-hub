// 引擎环境:必须继承父进程环境,否则子进程会丢掉 PATH/HOME/PLAYWRIGHT_BROWSERS_PATH。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { engineEnv } from '../src/engine.js'

const CONFIG = { browserDir: '/opt/epic/data/browser' }

test('继承父进程环境(丢掉 PLAYWRIGHT_BROWSERS_PATH 会让引擎找不到浏览器)', () => {
    process.env.PLAYWRIGHT_BROWSERS_PATH = '0'
    process.env.SOME_MARKER_FOR_TEST = 'yes'
    const env = engineEnv(CONFIG)
    assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, '0')
    assert.equal(env.SOME_MARKER_FOR_TEST, 'yes')
    delete process.env.SOME_MARKER_FOR_TEST
})

test('无人值守所需的覆盖项仍然生效', () => {
    const env = engineEnv(CONFIG)
    assert.equal(env.NOWAIT, '1')
    assert.equal(env.NOTIFY, '')
    assert.equal(env.EG_PASSWORD, '')
    assert.equal(env.BROWSER_DIR, CONFIG.browserDir)
})

test('显式传入的 env 优先级最高', () => {
    const env = engineEnv(CONFIG, { DRYRUN: '1' })
    assert.equal(env.DRYRUN, '1')
})

test('外部环境里的 EG_PASSWORD 会被清空(不继承凭据)', () => {
    process.env.EG_PASSWORD = '${EG_PASSWORD_PLACEHOLDER}'
    const env = engineEnv(CONFIG)
    assert.equal(env.EG_PASSWORD, '')
    delete process.env.EG_PASSWORD
})
