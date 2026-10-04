// 临时自检:错峰(同伴锁)判定。跑法:
//   docker compose -f /srv/apps/automation/compose.yaml run --rm -T \
//     --entrypoint node weread-run /opt/deploy/test-peer.mjs
import { peerBusy } from '/opt/weread/src/peer.js'

const lock = '/peers/rewards/run.lock'
console.log('同伴锁路径:', lock)
console.log('无锁:', JSON.stringify(peerBusy([lock])))
