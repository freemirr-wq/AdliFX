/* =====================================================
   ADLI FX INTEL INDICATOR
   MARKET DATA ENGINE V1.0
   Twelve Data + Supabase Edge Function
===================================================== */

(function () {
    "use strict";

    const CONFIG = window.ADLI_CONFIG;

    if (!CONFIG) {
        console.error("ADLI: Configuration missing.");
        return;
    }

    const SUPABASE_URL = CONFIG.SUPABASE_URL;
    const SUPABASE_KEY = CONFIG.SUPABASE_KEY;

    const FUNCTION_URL =
        SUPABASE_URL.replace(/\/$/, "") +
        "/functions/v1/market-data";

    const SYMBOL = "XAU/USD";

    const TIMEFRAMES = {
        "1m": "1min",
        "5m": "5min",
        "15m": "15min",
        "30m": "30min",
        "1h": "1h",
        "4h": "4h",
        "1d": "1day"
    };

    const REFRESH_INTERVAL = 60000;

    let currentTimeframe = "1m";
    let marketData = [];
    let refreshTimer = null;
    let isLoading = false;

    const MarketData = {

        status: "WAITING",
        price: null,
        previousPrice: null,
        lastUpdated: null,
        error: null,

        async fetch(timeframe = currentTimeframe) {

            if (!CONFIG.MARKET_DATA_ENABLED) {
                this.status = "DISABLED";
                this.updateUI();
                return;
            }

            if (isLoading) return;

            isLoading = true;
            this.status = "LOADING";
            this.error = null;
            this.updateUI();

            try {

                const interval = TIMEFRAMES[timeframe];

                if (!interval) {
                    throw new Error("Unsupported timeframe");
                }

                const params = new URLSearchParams({
                    symbol: SYMBOL,
                    interval: interval
                });

                const response = await fetch(
                    FUNCTION_URL + "?" + params.toString(),
                    {
                        method: "GET",
                        headers: {
                            "apikey": SUPABASE_KEY,
                            "Authorization": "Bearer " + SUPABASE_KEY
                        }
                    }
                );

                const result = await response.json();

                if (!response.ok || result.success !== true) {
                    throw new Error(
                        result.error || "Market data request failed"
                    );
                }

                if (!Array.isArray(result.values) ||
                    result.values.length === 0) {
                    throw new Error("No market data returned");
                }

                marketData = result.values;

                const latest = marketData[0];
                const price = Number(latest.close);

                if (!Number.isFinite(price)) {
                    throw new Error("Invalid market price");
                }

                this.previousPrice = this.price;
                this.price = price;
                this.lastUpdated = new Date();
                this.status = "CONNECTED";
                this.error = null;

                currentTimeframe = timeframe;

                console.log("ADLI MARKET DATA:", {
                    symbol: result.symbol,
                    timeframe: timeframe,
                    price: price,
                    latest: latest
                });

            } catch (error) {

                this.status = "ERROR";
                this.error = error.message;

                console.error(
                    "ADLI MARKET DATA ERROR:",
                    error
                );

            } finally {

                isLoading = false;
                this.updateUI();

            }
        },

        updateUI() {

            const priceElements = [
                "#marketPrice",
                "#currentPrice",
                "#xauPrice",
                "[data-market-price]"
            ];

            priceElements.forEach(selector => {
                document.querySelectorAll(selector).forEach(element => {
                    if (this.price !== null) {
                        element.textContent =
                            this.price.toFixed(2);
                    }
                });
            });

            const statusElements = [
                "#marketStatus",
                "#dataStatus",
                "[data-market-status]"
            ];

            statusElements.forEach(selector => {
                document.querySelectorAll(selector).forEach(element => {
                    element.textContent = this.status;
                });
            });

            const updateElements = [
                "#lastUpdated",
                "[data-last-updated]"
            ];

            updateElements.forEach(selector => {
                document.querySelectorAll(selector).forEach(element => {
                    element.textContent = this.lastUpdated
                        ? this.lastUpdated.toLocaleTimeString()
                        : "--";
                });
            });

            const errorElement =
                document.querySelector("#marketError");

            if (errorElement) {
                errorElement.textContent = this.error || "";
            }

            window.dispatchEvent(
                new CustomEvent("adli:market-update", {
                    detail: {
                        status: this.status,
                        symbol: SYMBOL,
                        price: this.price,
                        candles: marketData,
                        timeframe: currentTimeframe,
                        updatedAt: this.lastUpdated,
                        error: this.error
                    }
                })
            );
        },

        start() {

            this.fetch(currentTimeframe);

            if (refreshTimer) {
                clearInterval(refreshTimer);
            }

            refreshTimer = setInterval(() => {
                this.fetch(currentTimeframe);
            }, REFRESH_INTERVAL);

        },

        setTimeframe(timeframe) {

            if (!TIMEFRAMES[timeframe]) return;

            currentTimeframe = timeframe;
            this.fetch(timeframe);

        },

        getCandles() {
            return marketData;
        },

        getPrice() {
            return this.price;
        },

        getStatus() {
            return this.status;
        }
    };

    window.ADLI_MARKET = MarketData;

    document.addEventListener("DOMContentLoaded", () => {

        document.querySelectorAll("[data-timeframe]").forEach(button => {

            button.addEventListener("click", () => {

                const timeframe =
                    button.getAttribute("data-timeframe");

                MarketData.setTimeframe(timeframe);

            });

        });

        MarketData.start();

    });

    console.log("ADLI Market Data Engine initialized.");

})();
