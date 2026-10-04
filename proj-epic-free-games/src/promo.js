// 免费清单解析(纯函数,不发请求):
// GET https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=..&country=..&allowCountries=..
// 免费项的判据是 discountPercentage === 0 且 now 落在 startDate..endDate 内;
// 预告项在同名的 upcomingPromotionalOffers 里。字段名以 claabs/epicgames-freegames-node 的
// 类型定义与上游 vogler/free-games-claimer 的取值顺序为准。
export const FREE_GAMES_ENDPOINT = 'https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions'

export const freeGamesUrl = (locale = 'zh-CN', country = 'CN', allowCountries = country) =>
    `${FREE_GAMES_ENDPOINT}?locale=${encodeURIComponent(locale)}&country=${encodeURIComponent(country)}&allowCountries=${encodeURIComponent(allowCountries)}`

export const storeUrl = (slug) => (slug ? `https://store.epicgames.com/en-US/p/${slug}` : '')

/** 上游同款页面链接:`?offers=1-<namespace>-<offerId>`;缺字段就退回商店页。 */
export const checkoutUrl = (game = {}) =>
    game.offerId && game.namespace
        ? `https://www.epicgames.com/store/purchase?offers=1-${game.namespace}-${game.offerId}`
        : storeUrl(game.slug)

const firstMapping = (mappings) => (Array.isArray(mappings) ? mappings.find((m) => m && m.pageType === 'productHome') ?? mappings[0] : null)

/** 商店页 slug:与上游 getGameUrls 的取值顺序逐项一致。 */
export function offerSlug(element = {}) {
    return (
        firstMapping(element.catalogNs?.mappings)?.pageSlug ??
        firstMapping(element.offerMappings)?.pageSlug ??
        element.productSlug?.replace(/\/home$/, '') ??
        element.urlSlug ??
        null
    )
}

const inWindow = (startDate, endDate, now) => {
    const start = new Date(startDate)
    const end = new Date(endDate)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
    return start <= now && now <= end ? { startAt: start, endAt: end } : null
}

/** 每个 promotion 组里第一个「免费且 now 在窗口内」的窗口。 */
function pickWindow(groups, now, { future }) {
    for (const group of Array.isArray(groups) ? groups : []) {
        for (const entry of Array.isArray(group?.promotionalOffers) ? group.promotionalOffers : []) {
            if (Number(entry?.discountSetting?.discountPercentage) !== 0) continue
            const start = new Date(entry?.startDate)
            if (Number.isNaN(start.getTime())) continue
            if (future ? start <= now : false) continue
            const window = future ? (start > now ? { startAt: start, endAt: new Date(entry.endDate) } : null) : inWindow(entry.startDate, entry.endDate, now)
            if (!window) continue
            if (Number.isNaN(window.endAt.getTime())) continue
            return window
        }
    }
    return null
}

export const freeWindow = (element = {}, now = new Date()) => pickWindow(element?.promotions?.promotionalOffers, now, { future: false })

export const upcomingWindow = (element = {}, now = new Date()) => pickWindow(element?.promotions?.upcomingPromotionalOffers, now, { future: true })

function toGame(element, window) {
    const slug = offerSlug(element)
    return {
        slug,
        title: String(element.title ?? slug ?? ''),
        url: storeUrl(slug),
        offerId: element.id ? String(element.id) : '',
        namespace: element.namespace ? String(element.namespace) : '',
        startAt: window.startAt,
        endAt: window.endAt,
        originalPrice: element.price?.totalPrice?.fmtPrice?.originalPrice ?? '',
        currency: element.price?.totalPrice?.currencyCode ?? ''
    }
}

const elementsOf = (json) => {
    const elements = json?.data?.Catalog?.searchStore?.elements
    return Array.isArray(elements) ? elements : null
}

/** 统一入口:坏输入返回 { ok:false, error },不抛。 */
export function parseFreeGames(json, now = new Date()) {
    if (!json || typeof json !== 'object' || Array.isArray(json)) return { ok: false, current: [], upcoming: [], error: '响应不是对象' }
    const elements = elementsOf(json)
    if (!elements) return { ok: false, current: [], upcoming: [], error: '响应缺少 data.Catalog.searchStore.elements' }
    const current = []
    const upcoming = []
    for (const element of elements) {
        const free = freeWindow(element, now)
        if (free && offerSlug(element)) current.push(toGame(element, free))
        const soon = upcomingWindow(element, now)
        if (soon && offerSlug(element)) upcoming.push(toGame(element, soon))
    }
    return { ok: true, current, upcoming }
}

export const currentFreeGames = (json, now = new Date()) => parseFreeGames(json, now).current
export const upcomingFreeGames = (json, now = new Date()) => parseFreeGames(json, now).upcoming
