import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { loadConfig, ROOT } from '../src/config.js'

test('BILIBILI_DIR 覆盖 root,派生路径跟着变', () => {
    const cfg = loadConfig({ BILIBILI_DIR: '/tmp/bili' })
    assert.equal(cfg.root, path.resolve('/tmp/bili'))
    assert.equal(cfg.stateFile, path.join(path.resolve('/tmp/bili'), 'data', 'state.json'))
    assert.equal(cfg.cookiesFile, path.join(path.resolve('/tmp/bili'), 'secrets', 'cookies.json'))
    assert.equal(cfg.lockFile, path.join(path.resolve('/tmp/bili'), 'data', 'run.lock'))
})

test('默认值', () => {
    const cfg = loadConfig({})
    assert.equal(cfg.root, ROOT)
    assert.equal(cfg.coinKeep, 20)
    assert.equal(cfg.coinMax, 5)
    assert.equal(cfg.consoleTimeoutMinutes, 20)
    assert.equal(cfg.maxAttempts, 2)
    assert.equal(cfg.consoleDir, '/app')
    assert.equal(cfg.consoleDll, '/app/Ray.BiliBiliTool.Console.dll')
    assert.equal(cfg.dayBoundaryHour, 4)
    assert.equal(cfg.minFreeMb, 800)
    assert.equal(cfg.dryRun, false)
    assert.deepEqual(cfg.busyPeers, [])
    assert.equal(cfg.webhookFile, path.join(ROOT, 'secrets', 'wecom-webhook.txt'))
})

test('环境变量覆盖', () => {
    const cfg = loadConfig({
        BILIBILI_COIN_KEEP: '0',
        BILIBILI_COIN_MAX: '3',
        BILIBILI_CONSOLE_TIMEOUT_MINUTES: '7',
        BILIBILI_MAX_ATTEMPTS: '1',
        BILIBILI_DAY_BOUNDARY_HOUR: '0',
        BILIBILI_DRY_RUN: '1',
        BILIBILI_BUSY_PEERS: '/a, /b',
        BILIBILI_UPSTREAM_COMMIT: 'deadbeef'
    })
    assert.equal(cfg.coinKeep, 0)
    assert.equal(cfg.coinMax, 3)
    assert.equal(cfg.consoleTimeoutMinutes, 7)
    assert.equal(cfg.maxAttempts, 1)
    assert.equal(cfg.dayBoundaryHour, 0)
    assert.equal(cfg.dryRun, true)
    assert.deepEqual(cfg.busyPeers, ['/a', '/b'])
    assert.equal(cfg.upstreamCommit, 'deadbeef')
})
