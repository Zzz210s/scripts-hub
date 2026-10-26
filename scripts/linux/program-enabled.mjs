#!/usr/bin/env node
// Linux 侧调度闸门:run-all.sh 用它决定「这一步要不要调」;apply-schedule.mjs 的干跑清单
// 通过 scripts/lib/schedule-linux.mjs 复用同一个判定函数,保证「干跑说一套、实跑做另一套」
// 不再出现。
//
//   node program-enabled.mjs list <schedule.json>            -> 启用的程序 id,按 order 一行一个
//   node program-enabled.mjs is-enabled <schedule.json> <id> -> 启用退出 0,禁用退出 1
//   node program-enabled.mjs due <schedule.json> <id> [日期]  -> 今天该不该跑:0 该跑 · 1 不是运行日
//
// 每周运行的程序(如 Epic 限免:周四 11:00 美东换挡 = 北京周四 23:00 或周五 00:00)用
// programs.<id>.linuxDays 声明,取值是星期名或 0-6(0=周日),可多个;不写 = 每天都跑。
// 日期默认取本机时区的今天,传 YYYY-MM-DD 可伪造,便于测试与补跑核对。
//
// 退出码是接口的一部分:0 启用 · 1 明确关闭 · 2 读不到。2 覆盖文件不存在、坏 JSON、程序
// 条目缺失、enabled/linuxEnabled 取值不是布尔。run-all.sh 只把 0 当「跑」,>=2 一律告警并
// 退回固定四程序清单 —— 「读不到」绝不允许被当成「已关闭」而让五项静默全跳过。
//
// 依据是 config/schedule.json(真源)里每个程序的 linuxEnabled,缺省回落到 enabled。
// 为什么要单独一个字段:enabled 是「Windows 计划任务要不要注册」,Epic 与 B站正是
// Windows 不注册、Linux 照跑;若拿 enabled 当 Linux 闸门,这两个会连带被关掉。百度贴吧
// 没有 Windows 运行器,enabled:false 经回落也就挡住了 Linux —— 与「真机验证前不跑」一致。
//
// 这个文件由部署包(tar -C scripts/linux)带到套件根目录,run-all.sh 就地调用;零依赖。
import fs from 'node:fs';

const USAGE = `用法:node program-enabled.mjs list <schedule.json>
     node program-enabled.mjs is-enabled <schedule.json> <程序id>
     node program-enabled.mjs due <schedule.json> <程序id> [YYYY-MM-DD]`;

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

/** 单一判定源,三态:true 启用 / false 明确关闭 / null 取值不合法或缺失即读不到。 */
export function linuxEnabledState(program) {
    if (!program || typeof program !== 'object') return null;
    const value = program.linuxEnabled === undefined ? program.enabled : program.linuxEnabled;
    if (value === undefined) return true;
    return typeof value === 'boolean' ? value : null;
}

/** 布尔视图:只有明确 true 才算启用,null 与 false 都判「不跑」。 */
export const linuxEnabled = (program) => linuxEnabledState(program) === true;

/** 星期名 -> 0-6(0=周日),与 Date.getDay() 对齐。 */
const DAY_NAMES = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const DAY_TEXT = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * 解析 linuxDays:返回 null 表示「没声明,每天都跑」;返回空 Set 表示取值非法(读不到)。
 * 非法不回落到「每天跑」—— 一个拼错的星期名不该让周更程序天天跑。
 */
export function linuxDaysState(program) {
    const raw = program?.linuxDays;
    // null 与 undefined 都算「没声明」(normalize 会把没声明的写成 null,不能当成非法)
    if (raw === undefined || raw === null) return null;
    if (!Array.isArray(raw) || raw.length === 0) return new Set();
    const days = new Set();
    for (const item of raw) {
        const key = typeof item === 'string' ? item.trim().toLowerCase() : item;
        if (typeof key === 'number' && Number.isInteger(key) && key >= 0 && key <= 6) days.add(key);
        else if (typeof key === 'string' && key in DAY_NAMES) days.add(DAY_NAMES[key]);
        else return new Set();
    }
    return days;
}

/** 这一天该不该跑:没声明运行日 -> 每天;声明了就按声明。 */
export function linuxDueOn(program, date = new Date()) {
    const days = linuxDaysState(program);
    if (days === null) return true;
    if (days.size === 0) return false;
    return days.has(date.getDay());
}

/** 供日志与干跑用的说明,如「仅周五」;每天跑返回空串。 */
export function linuxDaysText(program) {
    const days = linuxDaysState(program);
    if (days === null) return '';
    if (days.size === 0) return '运行日取值非法';
    return '仅周' + [...days].sort((a, b) => a - b).map((day) => DAY_TEXT[day]).join('、周');
}

/** 启用的程序 id,按 order 排序;没登记在 order 里的接在后面。 */
export function enabledIds(schedule) {
    const ids = [...new Set([...(schedule.order ?? []), ...Object.keys(schedule.programs ?? {})])];
    return ids.filter((id) => linuxEnabled(schedule.programs[id]));
}

/** 全量体检:整份配置能不能当闸门用;返回问题串数组,空数组 = 可用。 */
export function scheduleProblems(schedule) {
    const ids = [...new Set([...(schedule.order ?? []), ...Object.keys(schedule.programs ?? {})])];
    const problems = [];
    if (!ids.length) problems.push('配置里没有任何程序');
    for (const id of ids) {
        const entry = schedule.programs[id];
        if (entry === undefined) problems.push(`${id} 在配置里没有条目`);
        else if (linuxEnabledState(entry) === null) problems.push(`${id} 的启用取值必须是布尔`);
        else if (linuxDaysState(entry)?.size === 0) problems.push(`${id} 的 linuxDays 取值非法,只能是 mon..sun 或 0-6`);
    }
    return problems;
}

function main(argv) {
    const [command, file, id, dayArg] = argv;
    if (!command || !file || !['list', 'is-enabled', 'due'].includes(command)) {
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
    const problems = scheduleProblems(schedule);
    if (problems.length) {
        console.error(`[错误] 读不到调度配置 ${file},不能用作闸门:${problems.join(';')}`);
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
    if (command === 'due') {
        const program = schedule.programs[id];
        if (linuxDaysState(program)?.size === 0) {
            console.error(`[错误] ${id} 的 linuxDays 取值非法`);
            return 2;
        }
        const when = dayArg ? new Date(`${dayArg}T12:00:00`) : new Date();
        if (Number.isNaN(when.getTime())) {
            console.error(`[错误] 日期看不懂:${dayArg}`);
            return 2;
        }
        return linuxDueOn(program, when) ? 0 : 1;
    }
    const state = linuxEnabledState(schedule.programs[id]);
    if (state === null) {
        console.error(`[错误] 配置里没有程序 ${id},或它的取值不是布尔`);
        return 2;
    }
    return state ? 0 : 1;
}

// 被 import 时不执行(测试与 apply-schedule.mjs 复用判定);直接跑时按参数执行。
if (process.argv[1] && process.argv[1].endsWith('program-enabled.mjs')) {
    process.exitCode = main(process.argv.slice(2));
}
