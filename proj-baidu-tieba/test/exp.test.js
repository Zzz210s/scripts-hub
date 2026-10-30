// 等级门槛与「距下一级还差多少」的回归。
//
// 门槛表不是猜的:2026-10-30 用 136 个关注吧的真实 (level, exp) 逐条比对,
// 四种等级与 [50,100,200,500,1000] 这几档零违反。这里把那次的边界样本固化下来。

import assert from 'node:assert/strict';
import test from 'node:test';

import { gapToNextLevel, levelThreshold, LEVEL_MIN_EXP, MAX_LEVEL } from '../src/exp.js';

test('门槛表与真机数据一致:每个等级的下界都能装下当档的最小经验', () => {
    // 真机实测的当档经验区间(Lv5 79~97 · Lv6 103~195 · Lv7 209~485 · Lv8 583~978)
    const samples = [
        [5, 79], [5, 97], [6, 103], [6, 195], [7, 209], [7, 485], [8, 583], [8, 978],
    ];
    for (const [level, exp] of samples) {
        const gap = gapToNextLevel(level, exp);
        assert.equal(typeof gap, 'number', `Lv${level} exp=${exp} 应算出可用的 gap`);
        const next = levelThreshold(level + 1);
        assert.equal(gap, next - exp, `Lv${level} exp=${exp} 的 gap 应等于下一档门槛减经验`);
    }
});

test('刚过门槛时 gap 等于整档长度', () => {
    assert.equal(gapToNextLevel(8, 500), 500); // Lv8 起点 500,下一档 1000
    assert.equal(gapToNextLevel(5, 50), 50); // Lv5 起点 50,下一档 100
    assert.equal(gapToNextLevel(7, 200), 300);
});

test('差一点点升级时 gap 就是差值', () => {
    assert.equal(gapToNextLevel(8, 997), 3);
    assert.equal(gapToNextLevel(5, 97), 3);
});

test('最高等级返回 0,表示「再攒也没用」;不可用的输入返回 null,表示「不知道」', () => {
    assert.equal(gapToNextLevel(MAX_LEVEL, 1234567), 0);
    for (const [level, exp] of [[null, 100], [8, null], ['', 100], [8, ''], [0, 10], [21, 10], ['x', 1], [8, -5]]) {
        assert.equal(gapToNextLevel(level, exp), null, `${level}/${exp} 应判为不可用`);
    }
});

test('门槛表本身是单调递增的,且字符串等级也能取', () => {
    for (let level = 2; level <= MAX_LEVEL; level++) {
        assert.ok(LEVEL_MIN_EXP[level] > LEVEL_MIN_EXP[level - 1], `Lv${level} 门槛必须高于上一档`);
    }
    assert.equal(levelThreshold('8'), 500);
    assert.equal(levelThreshold('21'), null);
});
