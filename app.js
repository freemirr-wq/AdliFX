/* =====================================================
   ADLI FX INTEL INDICATOR
   MARKET DATA ENGINE V1.1
   Twelve Data + Supabase + Lightweight Charts
===================================================== */

(function () {
    "use strict";

    const CONFIG = window.ADLI_CONFIG;

    if (!CONFIG) {
        console.error("ADLI: Configuration missing.");
        return;
    }

    const FUNCTION_URL =
        CONFIG.SUPABASE_URL.replace(/\/$/, "") +
        "/functions/v1/market-data";

    const API_KEY = CONFIG.SUPABASE_KEY;
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

    let currentTimeframe = "5m";
    let candles = [];
    let chart = null;
    let candleSeries = null;
    let refreshTimer = null;
    let loading = false;

    const Market = {
        status: "WAITING",
        price: null,
        lastUpdated: null,
        error: null,

        initChart() {
            const container = document.getElementById("priceChart");

            if (!container || !window.LightweightCharts) {
                console.error("ADLI: Chart library unavailable.");
                return;
            }

            chart = LightweightCharts.createChart(container, {
                width: container.clientWidth,
                height: container.clientHeight,

                layout: {
                    background: { color: "#101827" },
                    textColor: "#8492a6"
                },

                grid: {
                    vertLines: { color: "#1c293a" },
                    horzLines: { color: "#1c293a" }
                },

                rightPriceScale: {
                    borderColor: "#263247"
                },

                timeScale: {
                    borderColor: "#263247",
                    timeVisible: true,
                    secondsVisible: false
                },

                crosshair: {
                    mode: 1
                }
            });

            candleSeries = chart.addCandlestickSeries({
                upColor: "#00c087",
                downColor: "#f6465d",
                borderUpColor: "#00c087",
                borderDownColor: "#f6465d",
                wickUpColor: "#00c087",
                wickDownColor: "#f6465d"
            });

            const resizeObserver = new ResizeObserver(() => {
                if (chart && container.clientWidth > 0) {
                    chart.applyOptions({
                        width: container.clientWidth,
                        height: container.clientHeight
                    });
                }
            });

            resizeObserver.observe(container);
        },

        convertCandles(values) {
            return values
                .map(item => {
                    const time = Math.floor(
                        new Date(item.datetime.replace(" ", "T") + "Z").getTime() / 1000
                    );

                    return {
                        time: time,
                        open: Number(item.open),
                        high: Number(item.high),
                        low: Number(item.low),
                        close: Number(item.close)
                    };
                })
                .filter(item =>
                    Number.isFinite(item.time) &&
                    Number.isFinite(item.open) &&
                    Number.isFinite(item.high) &&
                    Number.isFinite(item.low) &&
                    Number.isFinite(item.close)
                )
                .sort((a, b) => a.time - b.time);
        },

        async fetch(timeframe = currentTimeframe) {
            if (loading) return;

            if (CONFIG.MARKET_DATA_ENABLED !== true) {
                this.status = "DISABLED";
                this.updateUI();
                return;
            }

            loading = true;
            this.status = "LOADING";
            this.updateUI();

            try {
                const interval = TIMEFRAMES[timeframe];

                if (!interval) {
                    throw new Error("Invalid timeframe.");
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
                            "apikey": API_KEY,
                            "Authorization": "Bearer " + API_KEY
                        }
                    }
                );

                const result = await response.json();

                if (!response.ok || result.success !== true) {
                    throw new Error(
                        result.error || "Market data request failed."
                    );
                }

                if (!Array.isArray(result.values) ||
                    result.values.length === 0) {
                    throw new Error("No candle data received.");
                }

                const converted = this.convertCandles(result.values);

                if (converted.length === 0) {
                    throw new Error("Candle data format is invalid.");
                }

                candles = converted;

                this.price = candles[candles.length - 1].close;
                this.lastUpdated = new Date();
                this.status = "CONNECTED";
                this.error = null;

                currentTimeframe = timeframe;

                if (candleSeries) {
                    candleSeries.setData(candles);
                    chart.timeScale().fitContent();
                }

                console.log("ADLI MARKET DATA:", {
                    symbol: result.symbol,
                    timeframe,
                    price: this.price,
                    candleCount: candles.length
                });

            } catch (error) {
                this.status = "ERROR";
                this.error = error.message;

                console.error("ADLI MARKET ERROR:", error);

            } finally {
                loading = false;
                this.updateUI();
            }
        },

        updateUI() {
            const priceElement =
                document.getElementById("goldPrice");

            const statusElement =
                document.getElementById("dataStatus");

            const emptyElement =
                document.getElementById("chartEmpty");

            const trendElement =
                document.getElementById("marketTrend");

            if (priceElement) {
                priceElement.textContent =
                    this.price !== null
                        ? this.price.toFixed(2)
                        : "--";
            }

            if (statusElement) {
                statusElement.textContent = this.status;

                statusElement.style.color =
                    this.status === "CONNECTED"
                        ? "#00c087"
                        : "#f6465d";
            }

            if (emptyElement) {
                if (this.status === "CONNECTED") {
                    emptyElement.style.display = "none";
                } else {
                    emptyElement.style.display = "flex";
                    emptyElement.textContent =
                        this.error || "Waiting for market data...";
                }
            }

            if (trendElement && candles.length >= 2) {
                const latest = candles[candles.length - 1];
                const previous = candles[candles.length - 2];

                if (latest.close > previous.close) {
                    trendElement.textContent = "UP";
                    trendElement.style.color = "#00c087";
                } else if (latest.close < previous.close) {
                    trendElement.textContent = "DOWN";
                    trendElement.style.color = "#f6465d";
                } else {
                    trendElement.textContent = "FLAT";
                    trendElement.style.color = "#d9b45b";
                }
            }

            window.dispatchEvent(
                new CustomEvent("adli:market-update", {
                    detail: {
                        status: this.status,
                        symbol: SYMBOL,
                        price: this.price,
                        candles: candles,
                        timeframe: currentTimeframe,
                        updatedAt: this.lastUpdated,
                        error: this.error
                    }
                })
            );
        },

        setTimeframe(timeframe) {
            if (!TIMEFRAMES[timeframe]) return;

            currentTimeframe = timeframe;
            this.fetch(timeframe);
        },

        resizeChart() {
            const container = document.getElementById("priceChart");

            if (chart && container) {
                chart.applyOptions({
                    width: container.clientWidth,
                    height: container.clientHeight
                });
            }
        },

        getCandles() {
            return candles;
        },

        getPrice() {
            return this.price;
        },

        getStatus() {
            return this.status;
        }
    };

    window.ADLI_MARKET = Market;

    /* INITIALIZE */
    function start() {
        Market.initChart();

        document.querySelectorAll("[data-tf]").forEach(button => {
            button.addEventListener("click", () => {
                document.querySelectorAll("[data-tf]").forEach(item =>
                    item.classList.remove("active")
                );

                button.classList.add("active");
                Market.setTimeframe(button.dataset.tf);
            });
        });

        window.addEventListener("adli:timeframe-change", event => {
            if (event.detail && event.detail.timeframe) {
                Market.setTimeframe(event.detail.timeframe);
            }
        });

        Market.fetch(currentTimeframe);

        refreshTimer = setInterval(() => {
            Market.fetch(currentTimeframe);
        }, 60000);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }

    window.ADLI_APP = {
        resizeChart: () => Market.resizeChart()
    };

    console.log("ADLI Market Engine V1.1 initialized.");

})();
