// 入口:node src/index.js <plan|run|status|verify|pause|resume> [--dry]
import { main } from './cli.js'

try {
    process.exitCode = await main(process.argv)
} catch (error) {
    console.error(`执行失败:${error?.message ?? error}`)
    process.exitCode = 1
}
