// 免费清单解析:只认 discountPercentage === 0 且在窗口内的项;字段缺失/非 JSON 一律判失败而不抛。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFreeGames, currentFreeGames, upcomingFreeGames, offerSlug, freeWindow, upcomingWindow, checkoutUrl, storeUrl, freeGamesUrl } from '../src/promo.js'

const NOW = new Date('2026-10-05T12:00:00Z')

const offer = (startDate, endDate, discountPercentage) => ({ startDate, endDate, discountSetting: { discountType: 'PERCENTAGE', discountPercentage } })
const element = (over = {}) => ({
    title: 'System Shock 2: 25th Anniversary Remaster',
    id: 'abc123offering',
    namespace: 'ns123',
    catalogNs: { mappings: [{ pageType: 'productHome', pageSlug: 'system-shock-2-25th-anniversary-remaster' }] },
    urlSlug: 'fallback-slug',
    productSlug: 'system-shock-2/home',
    price: { totalPrice: { originalPrice: 7600, currencyCode: 'CNY', fmtPrice: { originalPrice: '¥76' } } },
    promotions: { promotionalOffers: [{ promotionalOffers: [offer('2026-10-01T15:00:00.000Z', '2026-10-08T15:00:00.000Z', 0)] }], upcomingPromotionalOffers: [] },
    ...over
})

const wrap = (elements) => ({ data: { Catalog: { searchStore: { elements } } } })

test('当期免费:discountPercentage 为 0 且在窗口内', () => {
    const games = currentFreeGames(wrap([element()]), NOW)
    assert.equal(games.length, 1)
    assert.equal(games[0].slug, 'system-shock-2-25th-anniversary-remaster')
    assert.equal(games[0].title, 'System Shock 2: 25th Anniversary Remaster')
    assert.equal(games[0].offerId, 'abc123offering')
    assert.equal(games[0].namespace, 'ns123')
    assert.equal(games[0].url, 'https://store.epicgames.com/en-US/p/system-shock-2-25th-anniversary-remaster')
    assert.equal(games[0].startAt.toISOString(), '2026-10-01T15:00:00.000Z')
    assert.equal(games[0].endAt.toISOString(), '2026-10-08T15:00:00.000Z')
    assert.equal(games[0].originalPrice, '¥76')
})

test('打折的项不算免费,窗口外的也不算', () => {
    const discounted = element({ promotions: { promotionalOffers: [{ promotionalOffers: [offer('2026-10-01T15:00:00.000Z', '2026-10-08T15:00:00.000Z', 50)] }] } })
    const expired = element({ promotions: { promotionalOffers: [{ promotionalOffers: [offer('2026-09-01T15:00:00.000Z', '2026-09-08T15:00:00.000Z', 0)] }] } })
    assert.deepEqual(currentFreeGames(wrap([discounted, expired]), NOW), [])
})

test('预告项走 upcomingPromotionalOffers', () => {
    const upcoming = element({ title: 'TerraScape', promotions: { promotionalOffers: [], upcomingPromotionalOffers: [{ promotionalOffers: [offer('2026-10-08T15:00:00.000Z', '2026-10-15T15:00:00.000Z', 0)] }] } })
    const list = upcomingFreeGames(wrap([upcoming]), NOW)
    assert.equal(list.length, 1)
    assert.equal(list[0].title, 'TerraScape')
    assert.equal(list[0].startAt.toISOString(), '2026-10-08T15:00:00.000Z')
    assert.equal(currentFreeGames(wrap([upcoming]), NOW).length, 0)
})

test('freeWindow / upcomingWindow 是纯判定,没有就返回 null', () => {
    const el = element()
    assert.equal(freeWindow(el, NOW).endAt.toISOString(), '2026-10-08T15:00:00.000Z')
    assert.equal(upcomingWindow(el, NOW), null)
    assert.equal(freeWindow({}, NOW), null)
    assert.equal(freeWindow({ promotions: {} }, NOW), null)
})

test('slug 优先级:productHome > mappings 首项 > offerMappings > productSlug(去 /home) > urlSlug', () => {
    assert.equal(offerSlug({ catalogNs: { mappings: [{ pageType: 'offer', pageSlug: 'first' }, { pageType: 'productHome', pageSlug: 'home' }] } }), 'home')
    assert.equal(offerSlug({ catalogNs: { mappings: [{ pageType: 'offer', pageSlug: 'first' }] } }), 'first')
    assert.equal(offerSlug({ offerMappings: [{ pageType: 'productHome', pageSlug: 'om' }], productSlug: 'p/home', urlSlug: 'u' }), 'om')
    assert.equal(offerSlug({ offerMappings: [{ pageType: 'x', pageSlug: 'om2' }], productSlug: 'p/home', urlSlug: 'u' }), 'om2')
    assert.equal(offerSlug({ productSlug: 'p/home', urlSlug: 'u' }), 'p')
    assert.equal(offerSlug({ urlSlug: 'u' }), 'u')
    assert.equal(offerSlug({}), null)
})

test('结账链接用 namespace 与 offerId;缺一个就退回商店页', () => {
    const game = { slug: 's', offerId: 'oid', namespace: 'ns' }
    assert.equal(checkoutUrl(game), 'https://www.epicgames.com/store/purchase?offers=1-ns-oid')
    assert.equal(checkoutUrl({ slug: 's', offerId: 'oid' }), storeUrl('s'))
    assert.equal(checkoutUrl({ slug: 's', namespace: 'ns' }), storeUrl('s'))
    assert.equal(checkoutUrl({}), '')
})

test('parseFreeGames 对坏输入返回 ok:false 且不抛', () => {
    assert.deepEqual(parseFreeGames(null, NOW), { ok: false, current: [], upcoming: [], error: '响应不是对象' })
    assert.equal(parseFreeGames({ data: {} }, NOW).ok, false)
    assert.equal(parseFreeGames({ data: { Catalog: { searchStore: { elements: 'x' } } } }, NOW).ok, false)
    const good = parseFreeGames(wrap([element()]), NOW)
    assert.equal(good.ok, true)
    assert.equal(good.current.length, 1)
})

test('freeGamesUrl 默认按中国区取,可用参数覆盖', () => {
    assert.equal(freeGamesUrl(), 'https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=zh-CN&country=CN&allowCountries=CN')
    assert.match(freeGamesUrl('en-US', 'US'), /country=US&allowCountries=US$/)
})
