// Linux 侧调度闸门:apply-schedule.mjs 打印的 Linux 清单(loadSchedule 的 linuxEnabled)
// 必须与 run-all.sh 实际调用的 program-enabled.mjs 输出一致,否则「干跑说一套、实跑做另一套」。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { enabledIds, linuxEnabled, linuxEnabledState, scheduleProblems } from '../linux/program-enabled.mjs';
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

// 非布尔取值只认「读不到」:闸门退出 2,干跑同样拒绝给清单,两边不各取一个方向。
test('非布尔 linuxEnabled:闸门与干跑都按读不到处理', () => {
    const loadWith = (file) => {
        const old = process.env.HAC_SCHEDULE_FILE;
        process.env.HAC_SCHEDULE_FILE = file;
        try { return loadSchedule(); } finally {
            if (old === undefined) delete process.env.HAC_SCHEDULE_FILE; else process.env.HAC_SCHEDULE_FILE = old;
        }
    };
    for (const value of [null, 'true', 1, 0, {}]) {
        const dir = tmp();
        const file = path.join(dir, 'schedule.json');
        fs.writeFileSync(file, JSON.stringify({ order: ['itself'], programs: { itself: { enabled: true, linuxEnabled: value } } }), 'utf8');
        assert.equal(gate(['is-enabled', file, 'itself']).status, 2, `linuxEnabled=${JSON.stringify(value)}`);
        assert.equal(gate(['list', file]).status, 2);
        assert.throws(() => loadWith(file), /必须是布尔/);
        assert.equal(linuxEnabledState({ enabled: true, linuxEnabled: value }), null);
    }
    assert.equal(linuxEnabled({ enabled: true, linuxEnabled: 'true' }), false);
    assert.equal(scheduleProblems({ order: ['a'], programs: {} }).length, 1);
});

// 闸门读不到时 run-all.sh 必须 fail-closed:跑固定四程序,贴吧不跑,并写告警。
const posix = (p) => p.replace(/\\/g, '/');
const hasBash = spawnSync('bash', ['-c', 'exit 0']).status === 0;
const PROGRAMS = [['microsoft-rewards', 'rewards'], ['weread-signin', 'weread'], ['epic-free-games', 'epic'], ['bilibili-tasks', 'bilibili'], ['baidu-tieba', 'tieba']];

function runSuite(scheduleBody) {
    const dir = posix(tmp());
    const bin = `${dir}/bin`;
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(`${dir}/home`, { recursive: true });
    fs.writeFileSync(`${bin}/flock`, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(`${bin}/flock`, 0o755);
    fs.copyFileSync(GATE, `${dir}/program-enabled.mjs`);
    fs.copyFileSync(path.join(REPO_DIR, 'scripts', 'linux', 'run-all.sh'), `${dir}/run-all.sh`);
    for (const [id, folder] of PROGRAMS) {
        fs.mkdirSync(`${dir}/${folder}`, { recursive: true });
        fs.writeFileSync(`${dir}/${folder}/run.sh`, `#!/bin/sh\necho ${id} >> "${dir}/logs/ran.log"\n`);
        fs.chmodSync(`${dir}/${folder}/run.sh`, 0o755);
    }
    if (scheduleBody !== null) fs.writeFileSync(`${dir}/schedule.json`, scheduleBody);
    const result = spawnSync('bash', [`${dir}/run-all.sh`], {
        encoding: 'utf8',
        env: { ...process.env, SUITE_DIR: dir, HOME: `${dir}/home`, PATH: `${bin}:${posix(process.env.PATH ?? '')}` },
    });
    const read = (rel) => (fs.existsSync(`${dir}/${rel}`) ? fs.readFileSync(`${dir}/${rel}`, 'utf8') : '');
    return { status: result.status, stderr: result.stderr, ran: read('logs/ran.log'), ledger: read('logs/suite.log') };
}

const FOUR = ['microsoft-rewards', 'weread-signin', 'epic-free-games', 'bilibili-tasks'];

test('run-all.sh:坏 JSON 不静默全跳过,退回四程序且贴吧不跑', { skip: !hasBash }, () => {
    const { status, ran, ledger, stderr } = runSuite('{not json');
    assert.equal(status, 0, stderr);
    assert.deepEqual(ran.trim().split('\n'), FOUR);
    assert.match(ledger, /调度闸门不可用/);
    assert.doesNotMatch(ledger, /百度贴吧退出码/);
});

test('run-all.sh:缺配置 fail-closed 四程序清单', { skip: !hasBash }, () => {
    const { status, ran, ledger } = runSuite(null);
    assert.equal(status, 0);
    assert.deepEqual(ran.trim().split('\n'), FOUR);
    assert.match(ledger, /调度闸门不可用/);
});

test('run-all.sh:正常配置四个照跑贴吧跳过', { skip: !hasBash }, () => {
    const { status, ran } = runSuite(fs.readFileSync(path.join(REPO_DIR, 'config', 'schedule.json'), 'utf8'));
    assert.equal(status, 0);
    assert.deepEqual(ran.trim().split('\n'), FOUR);
});
