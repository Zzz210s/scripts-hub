import { REWARDS_BASE_URL } from '../constants/urls'
import { type Page, type BrowserContext } from 'patchright'
import { ClickOptions, createCursor } from 'ghost-cursor-playwright-port'

import type { MicrosoftRewardsBot } from '../index'

export default class BrowserUtils {
    private bot: MicrosoftRewardsBot

    constructor(bot: MicrosoftRewardsBot) {
        this.bot = bot
    }

    async tryDismissAllMessages(page: Page): Promise<void> {
        try {
            const buttons = [
                { selector: '#acceptButton', label: 'AcceptButton' },
                { selector: '#wcpConsentBannerCtrl > * > button:first-child', label: 'Bing Cookies Accept' },
                { selector: '.ext-secondary.ext-button', label: '"Skip for now" Button' },
                { selector: '#iLandingViewAction', label: 'iLandingViewAction' },
                { selector: '#iShowSkip', label: 'iShowSkip' },
                { selector: '#iNext', label: 'iNext' },
                { selector: '#iLooksGood', label: 'iLooksGood' },
                { selector: '#idSIButton9', label: 'idSIButton9' },
                { selector: '.ms-Button.ms-Button--primary', label: 'Primary Button' },
                { selector: '.c-glyph.glyph-cancel', label: 'Mobile Welcome Button' },
                { selector: '.maybe-later', label: 'Mobile Rewards App Banner' },
                { selector: '#bnp_btn_accept', label: 'Bing Cookie Banner' },
                { selector: '#reward_pivot_earn', label: 'Reward Coupon Accept' }
            ]

            const checkVisible = await Promise.allSettled(
                buttons.map(async b => ({
                    ...b,
                    isVisible: await page
                        .locator(b.selector)
                        .isVisible()
                        .catch(() => false)
                }))
            )

            const visibleButtons = checkVisible
                .filter(r => r.status === 'fulfilled' && r.value.isVisible)
                .map(r => (r.status === 'fulfilled' ? r.value : null))
                .filter(Boolean)

            if (visibleButtons.length > 0) {
                await Promise.allSettled(
                    visibleButtons.map(async b => {
                        if (b) {
                            const clicked = await this.ghostClick(page, b.selector)
                            if (clicked) {
                                this.bot.logger.debug(
                                    this.bot.isMobile,
                                    'DISMISS-ALL-MESSAGES',
                                    `Dismissed: ${b.label}`
                                )
                            }
                        }
                    })
                )
                await this.bot.utils.wait(300)
            }

            const overlay = await page.$('#bnp_overlay_wrapper')
            if (overlay) {
                const rejected = await this.ghostClick(page, '#bnp_btn_reject, button[aria-label*="Reject" i]')
                if (rejected) {
                    this.bot.logger.debug(this.bot.isMobile, 'DISMISS-ALL-MESSAGES', 'Dismissed: Bing Overlay Reject')
                } else {
                    const accepted = await this.ghostClick(page, '#bnp_btn_accept')
                    if (accepted) {
                        this.bot.logger.debug(
                            this.bot.isMobile,
                            'DISMISS-ALL-MESSAGES',
                            'Dismissed: Bing Overlay Accept'
                        )
                    }
                }
                await this.bot.utils.wait(250)
            }
        } catch (error) {
            this.bot.logger.warn(
                this.bot.isMobile,
                'DISMISS-ALL-MESSAGES',
                `Handler error: ${error instanceof Error ? error.message : String(error)}`
            )
        }
    }

    async getLatestTab(page: Page): Promise<Page> {
        try {
            const browser: BrowserContext = page.context()
            const pages = browser.pages()

            const newTab = pages[pages.length - 1]
            if (!newTab) {
                throw new Error('No tabs could be found!')
            }

            return newTab
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'GET-NEW-TAB',
                `Unable to get latest tab: ${error instanceof Error ? error.message : String(error)}`
            )
            throw error
        }
    }

    /**
     * Reload the current page while tolerating aborted navigations.
     *
     * Playwright turns a reload that collides with an in-flight navigation, with an
     * error page, or with a dropped connection into a rejection (`net::ERR_ABORTED`,
     * "maybe frame was detached?", `net::ERR_CONNECTION_RESET`). Those are transient,
     * but when they escaped the login state loop they killed the whole account run.
     * Retry a few times, fall back to a plain navigation of the current http(s) URL,
     * and report the outcome instead of throwing.
     */
    async reloadPageResilient(page: Page, label = 'RELOAD'): Promise<boolean> {
        const maxAttempts = 3
        const transient =
            /ERR_ABORTED|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_CONNECTION_ABORTED|ERR_NETWORK_CHANGED|ERR_EMPTY_RESPONSE|ERR_TIMED_OUT|ERR_FAILED|frame was detached|interrupted by another navigation|has been closed/i

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            if (page.isClosed()) return false

            try {
                await page.reload({ waitUntil: 'domcontentloaded' })
                return true
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                this.bot.logger.warn(
                    this.bot.isMobile,
                    label,
                    `Reload failed, treating it as a transient navigation | attempt=${attempt}/${maxAttempts} | error=${message}`
                )
                if (!transient.test(message)) return false
            }

            await this.bot.utils.wait(1500)

            // A reload that lost its frame leaves the old document detached; navigating to
            // the current http(s) URL rebuilds it. Error pages have no address to retry, so
            // for those the caller's state loop recovers on its own.
            const currentUrl = page.url()
            if (!/^https?:/i.test(currentUrl)) continue

            try {
                await page.goto(currentUrl, { waitUntil: 'domcontentloaded' })
                return true
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                this.bot.logger.warn(
                    this.bot.isMobile,
                    label,
                    `Fallback navigation failed | attempt=${attempt}/${maxAttempts} | error=${message}`
                )
                await this.bot.utils.wait(1500)
            }
        }

        this.bot.logger.warn(
            this.bot.isMobile,
            label,
            `Page could not be reloaded after ${maxAttempts} attempts; continuing without a refresh`
        )
        return false
    }

    async reloadBadPage(page: Page): Promise<boolean> {
        try {
            const html = await page.content().catch(() => '')
            const isBadPage = /<body[^>]*\bclass=["'][^"']*\bneterror\b/i.test(html)

            if (isBadPage) {
                this.bot.logger.info(this.bot.isMobile, 'RELOAD-BAD-PAGE', 'Bad page detected, reloading!')
                await this.reloadPageResilient(page, 'RELOAD-BAD-PAGE')
                return true
            } else {
                return false
            }
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'RELOAD-BAD-PAGE',
                `Reload check failed: ${error instanceof Error ? error.message : String(error)}`
            )
            return true
        }
    }

    async closeTabs(page: Page, config = { minTabs: 1, maxTabs: 1 }): Promise<Page> {
        try {
            const browser = page.context()
            const tabs = browser.pages()

            this.bot.logger.debug(
                this.bot.isMobile,
                'SEARCH-CLOSE-TABS',
                `Found ${tabs.length} tab(s) open (min: ${config.minTabs}, max: ${config.maxTabs})`
            )

            if (config.minTabs < 1 || config.maxTabs < config.minTabs) {
                this.bot.logger.warn(this.bot.isMobile, 'SEARCH-CLOSE-TABS', 'Invalid config, using defaults')
                config = { minTabs: 1, maxTabs: 1 }
            }

            if (tabs.length > config.maxTabs) {
                const tabsToClose = tabs.slice(config.maxTabs)

                const closeResults = await Promise.allSettled(tabsToClose.map(tab => tab.close()))

                const closedCount = closeResults.filter(r => r.status === 'fulfilled').length
                this.bot.logger.debug(
                    this.bot.isMobile,
                    'SEARCH-CLOSE-TABS',
                    `Closed ${closedCount}/${tabsToClose.length} excess tab(s) to reach max of ${config.maxTabs}`
                )
            } else if (tabs.length < config.minTabs) {
                const tabsNeeded = config.minTabs - tabs.length
                this.bot.logger.debug(
                    this.bot.isMobile,
                    'SEARCH-CLOSE-TABS',
                    `Opening ${tabsNeeded} tab(s) to reach min of ${config.minTabs}`
                )

                const newTabPromises = Array.from({ length: tabsNeeded }, async () => {
                    try {
                        const newPage = await browser.newPage()
                        await newPage.goto(REWARDS_BASE_URL, { waitUntil: 'domcontentloaded', timeout: 15000 })
                        return newPage
                    } catch (error) {
                        this.bot.logger.warn(
                            this.bot.isMobile,
                            'SEARCH-CLOSE-TABS',
                            `Failed to create new tab: ${error instanceof Error ? error.message : String(error)}`
                        )
                        return null
                    }
                })

                await Promise.allSettled(newTabPromises)
            }

            const latestTab = await this.getLatestTab(page)
            return latestTab
        } catch (error) {
            this.bot.logger.error(
                this.bot.isMobile,
                'SEARCH-CLOSE-TABS',
                `Error: ${error instanceof Error ? error.message : String(error)}`
            )
            return page
        }
    }

    async ghostClick(page: Page, selector: string, options?: ClickOptions): Promise<boolean> {
        try {
            this.bot.logger.debug(
                this.bot.isMobile,
                'GHOST-CLICK',
                `Trying to click selector: ${selector}, options: ${JSON.stringify(options)}`
            )

            await page.waitForSelector(selector, { timeout: 1000 }).catch(() => {})

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const cursor = createCursor(page as any)
            await cursor.click(selector, options)

            return true
        } catch (error) {
            this.bot.logger.warn(
                this.bot.isMobile,
                'GHOST-CLICK',
                `Failed for ${selector}: ${error instanceof Error ? error.message : String(error)}`
            )
            return false
        }
    }

    async disableFido(page: Page) {
        const routePattern = '**/GetCredentialType.srf*'
        await page.route(routePattern, route => {
            try {
                const request = route.request()
                const postData = request.postData()

                const body = postData ? JSON.parse(postData) : {}

                body.isFidoSupported = false

                this.bot.logger.debug(
                    this.bot.isMobile,
                    'DISABLE-FIDO',
                    `Modified request body: isFidoSupported set to ${body.isFidoSupported}`
                )

                route.continue({
                    postData: JSON.stringify(body),
                    headers: {
                        ...request.headers(),
                        'Content-Type': 'application/json'
                    }
                })
            } catch (error) {
                this.bot.logger.debug(
                    this.bot.isMobile,
                    'DISABLE-FIDO',
                    `An error occurred: ${error instanceof Error ? error.message : String(error)}`
                )
                route.continue()
            }
        })
    }
}
