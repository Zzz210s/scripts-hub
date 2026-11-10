// 探针:找「书币即将过期」到底从哪个接口来。
//
// 背景:2026-11-10 实测 POST /pay/balance 只回 balance / giftBalance / peerBalance /
// peerGiftBalance / isPromoting / paperBalance / incentive,没有过期字段,消息里一直写 0.00。
// 这个探针把可能的名字一次性试掉,谁回 200 谁就是答案。
//
// 用法(容器内):node /opt/weread/tools/probe-coin-expire.mjs
// 只读:全是查余额/明细的 GET/POST,不改任何东西。

import { readFileSync } from 'node:fs';

import { APP_BASE, appHeaders, ensureAppToken, credentialsPath, tokenPath } from '/opt/weread/src/app-auth.js';

const PF = 'wechat_wx-2001-android-100-weread';
const APP_PATHS = [
    '/pay/coin', '/pay/coin/detail', '/pay/coin/history', '/pay/coin/record', '/pay/coin/list',
    '/pay/coin/expire', '/pay/coin/expireDetail', '/pay/coin/expiring', '/pay/coin/info',
    '/pay/coin/balanceDetail', '/pay/coinBalance', '/pay/balanceInfo', '/pay/balance/expire',
    '/pay/balance/history', '/pay/balance/expireList', '/pay/balance/detail', '/pay/balanceDetail',
    '/pay/asset', '/pay/asset/list', '/pay/wallet', '/pay/wallet/detail', '/pay/recharge/list',
    '/pay/gift/expire', '/pay/gift/balance', '/pay/expire', '/pay/expiry', '/pay/expireInfo',
    '/pay/expire/list', '/pay/coinDetail', '/pay/payList', '/pay/balanceRecord'
];

/** 从 curl 文件里取 Cookie 头,给网页版接口用。 */
function webCookie() {
    try {
        const text = readFileSync('/opt/weread/secrets/read-request.curl', 'utf8');
        const header = /-H\s+'cookie:\s*([^']+)'/i.exec(text) ?? /-H\s+"cookie:\s*([^"]+)"/i.exec(text);
        if (header?.[1]) return header[1].trim();
        // 这份 curl 用的是 -b 'wr_gid=…; wr_skey=…',两种写法都要认
        const jar = /(?:^|\s)-b\s+'([^']+)'/m.exec(text) ?? /(?:^|\s)-b\s+"([^"]+)"/m.exec(text);
        return jar?.[1]?.trim() ?? '';
    } catch {
        return '';
    }
}

const token = await ensureAppToken({
    curlFile: '/opt/weread/secrets/read-request.curl',
    tokenFile: tokenPath('/opt/weread'),
    credentialsFile: credentialsPath('/opt/weread')
});
console.log(`token ok=${token.ok}`);

async function tryApp(path, method) {
    try {
        const response = await fetch(`${APP_BASE}${path}`, {
            method,
            headers: appHeaders(token),
            ...(method === 'POST' ? { body: JSON.stringify({ pf: PF }) } : {}),
            signal: AbortSignal.timeout(10000)
        });
        if (response.status === 404) return;
        const text = await response.text();
        console.log(`[app ${method}] ${path} -> ${response.status} ${text.slice(0, 240).replace(/\s+/g, ' ')}`);
    } catch (error) {
        console.log(`[app ${method}] ${path} -> 错误 ${error.message}`);
    }
}

for (const path of APP_PATHS) await tryApp(path, 'POST');

// 已知能用的余额接口,再试几种「多给点信息」的参数
for (const extra of [{ needExpire: 1 }, { withExpire: 1 }, { version: 2 }, { scene: 2 }]) {
    const response = await fetch(`${APP_BASE}/pay/balance`, {
        method: 'POST',
        headers: appHeaders(token),
        body: JSON.stringify({ pf: PF, ...extra }),
        signal: AbortSignal.timeout(10000)
    });
    console.log(`[balance+${JSON.stringify(extra)}] ${response.status} ${(await response.text()).slice(0, 240)}`);
}

// 网页版:i.weread.qq.com 走 cookie,路径形态与 App 不同
const cookie = webCookie();
if (cookie) {
    const webPaths = [
        '/web/pay/balance', '/web/pay/coin', '/web/pay/coinDetail', '/web/pay/balanceDetail',
        '/web/coin/balance', '/web/pay/coin/list', '/web/pay/expire', '/web/pay/balance/expire'
    ];
    for (const path of webPaths) {
        try {
            const response = await fetch(`https://weread.qq.com${path}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Cookie: cookie },
                body: JSON.stringify({ pf: PF }),
                signal: AbortSignal.timeout(10000)
            });
            console.log(`[web] ${path} -> ${response.status} ${(await response.text()).slice(0, 200).replace(/\s+/g, ' ')}`);
        } catch (error) {
            console.log(`[web] ${path} -> 错误 ${error.message}`);
        }
    }
} else {
    console.log('（curl 里没有 cookie,跳过网页版接口）');
}
