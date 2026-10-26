// Linux 侧调度闸门:apply-schedule.mjs 打印的 Linux 清单(loadSchedule 的 linuxEnabled)
// 必须与 run-all.sh 实际调用的 program-enabled.mjs 输出一致,否则「干跑说一套、实跑做另一套」。
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { enabledIds, linuxDaysState, linuxDaysText, linuxDueOn, linuxEnabled, linuxEnabledState, scheduleProblems } from '../linux/program-enabled.mjs';
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

test('干跑清单 = run-all.sh 的闸门输出;贴吧与网易云真机验证通过后都已启用', () => {
    const { schedule } = loadSchedule();
    const fromGenerator = schedule.order.filter((id) => schedule.programs[id].linuxEnabled);
    assert.deepEqual(fromGenerator, ['microsoft-rewards', 'weread-signin', 'epic-free-games', 'bilibili-tasks', 'baidu-tieba', 'netease-cloud']);

    const listed = gate(['list', path.join(REPO_DIR, 'config', 'schedule.json')]);
    assert.equal(listed.status, 0, listed.stderr);
    assert.deepEqual(listed.stdout.trim().split('\n'), fromGenerator);
});

test('is-enabled:已验证的程序退出 0', () => {
    const file = path.join(REPO_DIR, 'config', 'schedule.json');
    assert.equal(gate(['is-enabled', file, 'baidu-tieba']).status, 0);
    assert.equal(gate(['is-enabled', file, 'weread-signin']).status, 0);
    assert.equal(gate(['is-enabled', file, 'epic-free-games']).status, 0);
    assert.equal(gate(['is-enabled', file, 'netease-cloud']).status, 0);
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
const PROGRAMS = [['microsoft-rewards', 'rewards'], ['weread-signin', 'weread'], ['epic-free-games', 'epic'], ['bilibili-tasks', 'bilibili'], ['baidu-tieba', 'tieba'], ['netease-cloud', 'netease']];

function runSuite(scheduleBody) {
    const dir = posix(tmp());
    const bin = `${dir}/bin`;
    fs.mkdirSync(bin, { recursive: true });
    fs.mkdirSync(`${dir}/home`, { recursive: true });
    fs.writeFileSync(`${bin}/flock`, '#!/bin/sh\nexit 0\n');
    fs.chmodSync(`${bin}/flock`, 0o755);
    fs.copyFileSync(GATE, `${dir}/program-enabled.mjs`);
    fs.copyFileSync(path.join(REPO_DIR, 'scripts', 'linux', 'run-all.sh'), `${dir}/run-all.sh`);
    fs.copyFileSync(path.join(REPO_DIR, 'scripts', 'linux', 'suite-guards.sh'), `${dir}/suite-guards.sh`);
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

test('run-all.sh:正常配置按配置跑,Epic 只在周五跑', { skip: !hasBash }, () => {
    const { status, ran, ledger } = runSuite(fs.readFileSync(path.join(REPO_DIR, 'config', 'schedule.json'), 'utf8'));
    assert.equal(status, 0);
    const expected = new Date().getDay() === 5
        ? [...FOUR, 'baidu-tieba', 'netease-cloud']
        : [...FOUR.filter((id) => id !== 'epic-free-games'), 'baidu-tieba', 'netease-cloud'];
    assert.deepEqual(ran.trim().split('\n'), expected);
    if (new Date().getDay() !== 5) assert.match(ledger, /Epic 限免 跳过:今天不是运行日/);
});

// 每周运行(Epic):linuxDays 声明后只在那些星期跑;不声明 = 每天跑;取值非法要响亮失败
test('linuxDays:周一不跑、周五跑、周六不跑', () => {
    const program = { enabled: false, linuxEnabled: true, linuxDays: ['fri'] };
    assert.equal(linuxDueOn(program, new Date('2026-10-26T12:00:00')), false); // 周一
    assert.equal(linuxDueOn(program, new Date('2026-10-30T12:00:00')), true); // 周五
    assert.equal(linuxDueOn(program, new Date('2026-10-31T12:00:00')), false); // 周六
    assert.equal(linuxDaysText(program), '仅周五');
});

test('linuxDays:接受 0-6 与大小写星期名;不声明按每天;非法取值判读不到', () => {
    assert.equal(linuxDueOn({ linuxDays: [5] }, new Date('2026-10-30T12:00:00')), true);
    assert.equal(linuxDueOn({ linuxDays: ['FRI'] }, new Date('2026-10-30T12:00:00')), true);
    assert.equal(linuxDueOn({ linuxDays: ['mon', 'thu'] }, new Date('2026-10-26T12:00:00')), true);
    assert.equal(linuxDueOn({}, new Date('2026-10-26T12:00:00')), true);
    assert.equal(linuxDueOn({ linuxDays: ['friday'] }, new Date('2026-10-30T12:00:00')), false);
    assert.equal(linuxDaysState({ linuxDays: ['friday'] }).size, 0);
    assert.deepEqual(
        scheduleProblems({ order: ['x'], programs: { x: { linuxEnabled: true, linuxDays: ['nope'] } } }),
        ['x 的 linuxDays 取值非法,只能是 mon..sun 或 0-6']
    );
});

test('due 子命令:退出码 0/1/2 三态可区分,且 Epic 在配置里是周五', () => {
    const { schedule } = loadSchedule();
    assert.deepEqual(schedule.programs['epic-free-games'].linuxDays, [5]); // 归一成 0-6,fri = 5
    const file = path.join(tmp(), 'schedule.json');
    fs.writeFileSync(file, JSON.stringify(schedule));
    assert.equal(gate(['due', file, 'epic-free-games', '2026-10-30']).status, 0);
    assert.equal(gate(['due', file, 'epic-free-games', '2026-10-31']).status, 1);
    const bad = path.join(tmp(), 'bad.json');
    fs.writeFileSync(bad, JSON.stringify({ order: ['x'], programs: { x: { linuxEnabled: true, linuxDays: ['nope'] } } }));
    assert.equal(gate(['due', bad, 'x']).status, 2);
});
