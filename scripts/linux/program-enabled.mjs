#!/usr/bin/env node
// Linux 侧调度闸门:run-all.sh 用它决定「这一步要不要调」。
//
//   node program-enabled.mjs list <schedule.json>            -> 启用的程序 id,按 order 一行一个
//   node program-enabled.mjs is-enabled <schedule.json> <id> -> 启用退出 0,禁用退出 1
//
// 依据是 config/schedule.json(真源)里每个程序的 linuxEnabled,缺省回落到 enabled。
// 为什么要单独一个字段:enabled 是「Windows 计划任务要不要注册」,Epic 与 B站正是
// Windows 不注册、Linux 照跑;若拿 enabled 当 Linux 闸门,这两个会连带被关掉。百度贴吧
// 没有 Windows 运行器,enabled:false 经回落也就挡住了 Linux —— 与「真机验证前不跑」一致。
//
// 这个文件由部署包(tar -C scripts/linux)带到套件根目录,run-all.sh 就地调用;零依赖。
import fs from 'node:fs';

const USAGE = `用法:node program-enabled.mjs list <schedule.json>
     node program-enabled.mjs is-enabled <schedule.json> <程序id>`;

/** 剥掉 _readme 一类注释键;坏 JSON 交给调用方处理。 */
function readSchedule(file) {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const out = { order: raw.order, programs: {} };
    for (const [id, value] of Object.entries(raw.programs ?? {})) {
        if (id.startsWith('_') || !value || typeof value !== 'object') continue;
        out.programs[id] = value;
    }
    return out;
}

/** 闸门:显式 linuxEnabled 优先,缺省回落 enabled(再缺省按启用)。 */
export const linuxEnabled = (program) => {
    if (!program || typeof program !== 'object') return false;
    if (program.linuxEnabled !== undefined) return program.linuxEnabled === true;
    return program.enabled !== false;
};

/** 启用的程序 id,按 order 排序(没登记在 order 里的接在后面)。 */
export function enabledIds(schedule) {
    const ids = [...new Set([...(schedule.order ?? []), ...Object.keys(schedule.programs ?? {})])];
    return ids.filter((id) => linuxEnabled(schedule.programs[id]));
}

function main(argv) {
    const [command, file, id] = argv;
    if (!command || !file || !['list', 'is-enabled'].includes(command)) {
        console.error(USAGE);
        return 2;
    }
    let schedule;
    try {
        schedule = readSchedule(file);
    } catch (error) {
        console.error(`[错误] 读不到调度配置 ${file}:${error.message}`);
        return 2;
    }
    if (command === 'list') {
        for (const item of enabledIds(schedule)) console.log(item);
        return 0;
    }
    if (!id) {
        console.error(USAGE);
        return 2;
    }
    return linuxEnabled(schedule.programs[id]) ? 0 : 1;
}

// 被 import 时不执行(测试用);直接跑时按参数执行。
if (process.argv[1] && process.argv[1].endsWith('program-enabled.mjs')) {
    process.exitCode = main(process.argv.slice(2));
}
