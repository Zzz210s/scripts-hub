// Linux 侧调度闸门:apply-schedule.mjs 打印的 Linux 清单(loadSchedule 的 linuxEnabled)
// 必须与 run-all.sh 实际调用的 program-enabled.mjs 输出一致,否则「干跑说一套、实跑做另一套」。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { enabledIds, linuxEnabled } from '../linux/program-enabled.mjs';
import { loadSchedule, REPO_DIR } from '../lib/schedule.mjs';

const GATE = path.join(REPO_DIR, 'scripts', 'linux', 'program-enabled.mjs');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'schedule-gate-'));

const gate = (args) =>
    spawnSync(process.execPath, [GATE, ...args], { encoding: 'utf8', cwd: REPO_DIR });

test('闸门默认值:linuxEnabled 优先,缺省回落 enabled,再缺省按启用', () => {
    assert.equal(linuxEnabled({ enabled: true }), true);
    assert.equal(linuxEnabled({ enabled: false }), false);
    assert.equal(linuxEnabled({ enabled: false, linuxEnabled: true }), true); // Epic/B站:Windows 不注册、Linux 照跑
    assert.equal(linuxEnabled({ enabled: true, linuxEnabled: false }), false);
    assert.equal(linuxEnabled({}), true);
    assert.equal(linuxEnabled(undefined), false);
});

test('干跑清单 = run-all.sh 的闸门输出,百度贴吧被挡、现有四个照跑', () => {
    const { schedule } = loadSchedule();
    const fromGenerator = schedule.order.filter((id) => schedule.programs[id].linuxEnabled);
    assert.deepEqual(fromGenerator, ['microsoft-rewards', 'weread-signin', 'epic-free-games', 'bilibili-tasks']);

    const listed = gate(['list', path.join(REPO_DIR, 'config', 'schedule.json')]);
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(listed.stdout.trim().split('\n'), fromGenerator);
});

test('is-enabled:贴吧退出 1,微信读书退出 0', () => {
    const file = path.join(REPO_DIR, 'config', 'schedule.json');
    assert.equal(gate(['is-enabled', file, 'baidu-tieba']).status, 1);
    assert.equal(gate(['is-enabled', file, 'weread-signin']).status, 0);
    assert.equal(gate(['is-enabled', file, 'epic-free-games']).status, 0);
});

test('闸门对自定义配置与坏输入的行为', () => {
    const dir = tmp();
    const file = path.join(dir, 'schedule.json');
    fs.writeFileSync(
        file,
        JSON.stringify({
            _readme: { 说明: '注释键要忽略' },
            order: ['a', 'b', 'c'],
            programs: { a: { enabled: true }, b: { enabled: false, linuxEnabled: true }, c: { enabled: false } },
        }),
        'utf8',
    );
    const listed = gate(['list', file]);
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(listed.stdout.trim().split('\n'), ['a', 'b']);
    assert.equal(gate(['is-enabled', file, 'c']).status, 1);

    assert.equal(gate(['list', path.join(dir, 'absent.json')]).status, 2);
    fs.writeFileSync(path.join(dir, 'bad.json'), '{not json', 'utf8');
    assert.equal(gate(['list', path.join(dir, 'bad.json')]).status, 2);
    assert.equal(gate(['list']).status, 2);
    assert.deepEqual(enabledIds({ order: ['x', 'y'], programs: { x: { enabled: true }, y: { enabled: true } } }), ['x', 'y']);
});
