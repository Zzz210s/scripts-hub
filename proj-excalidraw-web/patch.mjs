// 把服务器存储面板注入上游 excalidraw-app。
//
// 为什么用"锚点插入"而不是 git patch:上游这两个文件改动频繁,patch 的上下文行天天变;
// 而"导入一行 + 渲染一行"的锚点很稳。锚点不在时**直接失败**,不会静默产出一个没有面板的构建。
//
// 用法(在 Dockerfile 里,构建上下文是上游源码根):
//   node patch.mjs            # 注入(幂等)
//   node patch.mjs --check    # 只检查锚点是否还在
import fs from 'node:fs'
import path from 'node:path'

const APP = 'excalidraw-app/App.tsx'
const IMPORT_ANCHOR = 'import { AppSidebar } from "./components/AppSidebar";'
const RENDER_ANCHOR = '      <Excalidraw\n        viewportStatusFrame={viewportStatusFrame}'
const MARK = 'ServerStorage'

const IMPORT_LINE = `${IMPORT_ANCHOR}\nimport { ServerStorage } from "./components/ServerStorage";`
const RENDER_LINE = `      {/* 服务器存储面板:保存到服务器 / 从服务器打开(Ctrl+S) */}\n      <ServerStorage excalidrawAPI={excalidrawAPI} />\n${RENDER_ANCHOR}`

const checkOnly = process.argv.includes('--check')

if (!fs.existsSync(APP)) {
    console.error(`[patch] 找不到 ${APP}(构建上下文应为上游源码根)`)
    process.exit(1)
}

const original = fs.readFileSync(APP, 'utf8').replace(/\r\n/g, '\n')
if (original.includes(MARK)) {
    console.log('[patch] 已注入过,跳过')
    process.exit(0)
}

const problems = []
if (!original.includes(IMPORT_ANCHOR)) problems.push(`缺少导入锚点:${IMPORT_ANCHOR}`)
if (!original.includes(RENDER_ANCHOR)) problems.push('缺少渲染锚点:<Excalidraw viewportStatusFrame=...')

for (const component of ['ServerStorage.tsx', 'serverStorageApi.ts', 'storageList.tsx', 'serverStorageHooks.ts'].map((f) => `excalidraw-app/components/${f}`)) {
    if (!fs.existsSync(component)) problems.push(`缺少组件文件 ${component}(应随构建上下文拷入)`)
}

if (problems.length) {
    for (const problem of problems) console.error(`[patch] ${problem}`)
    console.error('[patch] 上游结构变了:请更新 proj-excalidraw-web/patch.mjs 的锚点后再构建')
    process.exit(1)
}

if (checkOnly) {
    console.log('[patch] 锚点齐全')
    process.exit(0)
}

let patched = original.replace(IMPORT_ANCHOR, IMPORT_LINE)
patched = patched.replace(RENDER_ANCHOR, RENDER_LINE)
fs.writeFileSync(APP, patched, 'utf8')
console.log('[patch] 已注入 ServerStorage(import + render)')
