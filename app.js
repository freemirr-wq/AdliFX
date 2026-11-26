/* =========================================================
   ADLI FX INTEL INDICATOR
   APP ENGINE V2.1
   Twelve Data + Supabase + Lightweight Charts
   Technical rule-based analysis — NOT machine learning
========================================================= */

(function () {
    "use strict";

    const CONFIG = window.ADLI_CONFIG;

    if (!CONFIG) {
        console.error("ADLI V2.1: config.js missing.");
        return;
    }

    const FUNCTION_URL =
        String(CONFIG.SUPABASE_URL || "").replace(/\/$/, "") +
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

    const MTF_ELEMENTS = {
        "1m": "mtf1m",
        "5m": "mtf5m",
        "15m": "mtf15m",
        "30m": "mtf30m",
        "1h": "mtf1h",
        "4h": "mtf4h",
        "1d": "mtf1d"
    };

    // Conservative refresh schedule for Twelve Data Free.
    const REFRESH_MS = 5 * 60 * 1000;
    const MTF_REFRESH_MS = 60 * 60 * 1000;

    // Central request spacing to reduce rate-limit errors.
    const REQUEST_GAP_MS = 8000;

    let currentTimeframe = "5m";
    let candles = [];

    let chart = null;
    let candleSeries = null;
    let resizeObserver = null;

    let chartLoading = false;
    let mtfLoading = false;
    let started = false;

    let refreshTimer = null;
    let mtfTimer = null;

    let lastRequestTime = 0;
    let lastMtfUpdate = 0;

    let requestQueue = Promise.resolve();
    let mtfCache = {};

    let lastChartError = null;

    /* =====================================================
       HELPERS
    ===================================================== */

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function setText(id, value, color) {
        const element = document.getElementById(id);

        if (!element) return;

        element.textContent = value;

        if (color) {
            element.style.color = color;
        }
    }

    function formatPrice(value) {
        return Number(value).toFixed(2);
    }

    function queueRequest(task) {
        const run = requestQueue.then(async () => {
            const elapsed = Date.now() - lastRequestTime;
            const wait = Math.max(0, REQUEST_GAP_MS - elapsed);

            if (wait > 0) await sleep(wait);

            lastRequestTime = Date.now();

            return task();
        });

        requestQueue = run.catch(() => {});
        return run;
    }

    function dispatchMarketEvent(status, error) {
        window.dispatchEvent(
            new CustomEvent("adli:market-update", {
                detail: {
                    status: status,
                    symbol: SYMBOL,
                    price: Market.price,
                    candles: candles,
                    timeframe: currentTimeframe,
                    updatedAt: Market.lastUpdated,
                    error: error || null
                }
            })
        );
    }

    /* =====================================================
       MARKET DATA ENGINE
    ===================================================== */

    const Market = {
        status: "WAITING",
        price: null,
        lastUpdated: null,
        error: null,

        initChart() {
            const container =
                document.getElementById("priceChart");

            if (!container) {
                console.error("ADLI: priceChart element missing.");
                return;
            }

            if (!window.LightweightCharts) {
                this.status = "ERROR";
                this.error = "Chart library unavailable.";
                this.updateUI();
                return;
            }

            if (chart) return;

            try {
                chart = LightweightCharts.createChart(container, {
                    width: Math.max(300, container.clientWidth),
                    height: Math.max(250, container.clientHeight),

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
                    },

                    localization: {
                        priceFormatter: price =>
                            Number(price).toFixed(2)
                    }
                });

                // Supports both Lightweight Charts v4 and v5.
                if (typeof chart.addCandlestickSeries === "function") {
                    candleSeries = chart.addCandlestickSeries({
                        upColor: "#00c087",
                        downColor: "#f6465d",
                        borderUpColor: "#00c087",
                        borderDownColor: "#f6465d",
                        wickUpColor: "#00c087",
                        wickDownColor: "#f6465d",
                        priceLineVisible: true
                    });
                } else if (typeof chart.addSeries === "function" &&
                           LightweightCharts.CandlestickSeries) {
                    candleSeries = chart.addSeries(
                        LightweightCharts.CandlestickSeries,
                        {
                            upColor: "#00c087",
                            downColor: "#f6465d",
                            borderUpColor: "#00c087",
                            borderDownColor: "#f6465d",
                            wickUpColor: "#00c087",
                            wickDownColor: "#f6465d",
                            priceLineVisible: true
                        }
                    );
                } else {
                    throw new Error(
                        "Unsupported Lightweight Charts version."
                    );
                }

                if (window.ResizeObserver) {
                    resizeObserver = new ResizeObserver(() => {
                        this.resizeChart();
                    });

                    resizeObserver.observe(container);
                }

                window.addEventListener("resize", () => {
                    this.resizeChart();
                });

            } catch (error) {
                this.status = "ERROR";
                this.error = "Chart: " + error.message;
                console.error("ADLI CHART ERROR:", error);
                this.updateUI();
            }
        },

        convertCandles(values) {
            if (!Array.isArray(values)) return [];

            return values
                .map(item => {
                    const raw = String(item.datetime || "").trim();

                    // Twelve Data normally returns:
                    // YYYY-MM-DD HH:mm:ss
                    const normalized = raw.replace(" ", "T");

                    let timestamp;

                    if (/[zZ]|[+-]\d{2}:\d{2}$/.test(normalized)) {
                        timestamp = Date.parse(normalized);
                    } else {
                        // Twelve Data datetime is treated as UTC.
                        timestamp = Date.parse(normalized + "Z");
                    }

                    return {
                        time: Math.floor(timestamp / 1000),
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
                    Number.isFinite(item.close) &&
                    item.high >= item.low
                )
                .sort((a, b) => a.time - b.time)
                .filter((item, index, array) =>
                    index === 0 ||
                    item.time !== array[index - 1].time
                );
        },

        async request(timeframe) {
            if (!TIMEFRAMES[timeframe]) {
                throw new Error("Invalid timeframe: " + timeframe);
            }

            if (CONFIG.MARKET_DATA_ENABLED !== true) {
                throw new Error("Market data disabled in config.js.");
            }

            if (!FUNCTION_URL || !API_KEY) {
                throw new Error("Supabase configuration missing.");
            }

            const params = new URLSearchParams({
                symbol: SYMBOL,
                interval: TIMEFRAMES[timeframe]
            });

            const url = FUNCTION_URL + "?" + params.toString();

            // Publishable key is sent as apikey.
            // Verify JWT must remain OFF for this public data function.
            const response = await fetch(url, {
                method: "GET",
                headers: {
                    "apikey": API_KEY
                }
            });

            let result;

            try {
                result = await response.json();
            } catch (error) {
                throw new Error(
                    "Invalid JSON response. HTTP " + response.status
                );
            }

            if (!response.ok) {
                throw new Error(
                    "HTTP " + response.status + ": " +
                    (result.error || result.message || "Request failed")
                );
            }

            if (result.success !== true) {
                throw new Error(
                    result.error || result.message ||
                    "Provider did not return success=true."
                );
            }

            if (!Array.isArray(result.values) ||
                result.values.length === 0) {
                throw new Error("Provider returned no candle data.");
            }

            const converted = this.convertCandles(result.values);

            if (converted.length < 20) {
                throw new Error(
                    "Insufficient candles: " + converted.length +
                    " received; 20 required."
                );
            }

            return converted;
        },

        async fetch(timeframe = currentTimeframe) {
            if (chartLoading) return;

            chartLoading = true;

            this.status = candles.length ? "UPDATING" : "LOADING";
            this.error = null;
            this.updateUI();

            try {
                const received = await queueRequest(
                    () => this.request(timeframe)
                );

                candles = received;
                currentTimeframe = timeframe;

                this.price = candles[candles.length - 1].close;
                this.lastUpdated = new Date();
                this.status = "CONNECTED";
                this.error = null;
                lastChartError = null;

                if (candleSeries && chart) {
                    candleSeries.setData(candles);
                    chart.timeScale().fitContent();
                }

                analyseCurrent();
                this.updateUI();

                console.log("ADLI V2.1 DATA:", {
                    timeframe: timeframe,
                    count: candles.length,
                    price: this.price,
                    updated: this.lastUpdated
                });

            } catch (error) {
                this.status = "ERROR";
                this.error = error.message;
                lastChartError = error.message;

                // Do not leave old signal displayed as current.
                clearSignal("DATA ERROR — SIGNAL PAUSED");

                console.error("ADLI V2.1 MARKET ERROR:", error);

            } finally {
                chartLoading = false;
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
                        ? formatPrice(this.price)
                        : "--";
            }

            if (statusElement) {
                statusElement.textContent =
                    this.status === "ERROR"
                        ? "ERROR: " + (this.error || "Unknown error")
                        : this.status;

                statusElement.style.color =
                    this.status === "CONNECTED"
                        ? "#00c087"
                        : this.status === "UPDATING" ||
                          this.status === "LOADING"
                            ? "#d9b45b"
                            : "#f6465d";

                statusElement.title = this.error || "";
            }

            if (emptyElement) {
                if (candles.length > 0) {
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

            dispatchMarketEvent(this.status, this.error);
        },

        setTimeframe(timeframe) {
            if (!TIMEFRAMES[timeframe]) return;

            currentTimeframe = timeframe;
            this.fetch(timeframe);
        },

        resizeChart() {
            const container =
                document.getElementById("priceChart");

            if (!chart || !container) return;

            const width = container.clientWidth;
            const height = container.clientHeight;

            if (width > 0 && height > 0) {
                chart.applyOptions({
                    width: width,
                    height: height
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

    /* =====================================================
       TECHNICAL ANALYSIS
    ===================================================== */

    const Analysis = {
        ema(values, period) {
            if (!Array.isArray(values) ||
                values.length < period) return null;

            const multiplier = 2 / (period + 1);

            let average = 0;

            for (let i = 0; i < period; i++) {
                average += values[i];
            }

            average /= period;

            for (let i = period; i < values.length; i++) {
                average =
                    (values[i] - average) * multiplier + average;
            }

            return average;
        },

        rsi(values, period = 14) {
            if (!Array.isArray(values) ||
                values.length <= period) return null;

            let gains = 0;
            let losses = 0;

            for (let i = 1; i <= period; i++) {
                const change = values[i] - values[i - 1];

                if (change > 0) gains += change;
                if (change < 0) losses += Math.abs(change);
            }

            let averageGain = gains / period;
            let averageLoss = losses / period;

            for (let i = period + 1; i < values.length; i++) {
                const change = values[i] - values[i - 1];

                averageGain =
                    (averageGain * (period - 1) +
                    Math.max(change, 0)) / period;

                averageLoss =
                    (averageLoss * (period - 1) +
                    Math.max(-change, 0)) / period;
            }

            if (averageLoss === 0) {
                return averageGain === 0 ? 50 : 100;
            }

            const rs = averageGain / averageLoss;

            return 100 - (100 / (1 + rs));
        },

        atr(data, period = 14) {
            if (!Array.isArray(data) ||
                data.length <= period) return null;

            const ranges = [];

            for (let i = 1; i < data.length; i++) {
                const current = data[i];
                const previous = data[i - 1];

                ranges.push(Math.max(
                    current.high - current.low,
                    Math.abs(current.high - previous.close),
                    Math.abs(current.low - previous.close)
                ));
            }

            const recent = ranges.slice(-period);

            return recent.reduce((sum, value) =>
                sum + value, 0
            ) / recent.length;
        },

        analyse(data) {
            if (!Array.isArray(data) || data.length < 20) {
                return {
                    ready: false,
                    signal: "WAIT",
                    strength: 0,
                    reason: "Insufficient candle data"
                };
            }

            const closes = data.map(item => item.close);

            const ema9 = this.ema(closes, 9);
            const ema20 = this.ema(closes, 20);
            const rsi = this.rsi(closes, 14);
            const atr = this.atr(data, 14);

            if (ema9 === null || ema20 === null ||
                rsi === null || atr === null) {
                return {
                    ready: false,
                    signal: "WAIT",
                    strength: 0,
                    reason: "Indicator calculation unavailable"
                };
            }

            let score = 0;
            const latestPrice = closes[closes.length - 1];

            if (ema9 > ema20) score += 2;
            if (ema9 < ema20) score -= 2;

            if (latestPrice > ema20) score += 1;
            if (latestPrice < ema20) score -= 1;

            if (rsi >= 55 && rsi < 75) score += 1;
            if (rsi <= 45 && rsi > 25) score -= 1;

            let signal = "WAIT";

            if (score >= 3) signal = "BUY";
            if (score <= -3) signal = "SELL";

            return {
                ready: true,
                signal: signal,
                strength: Math.min(
                    100,
                    Math.round(Math.abs(score) / 4 * 100)
                ),
                score: score,
                ema9: ema9,
                ema20: ema20,
                rsi: rsi,
                atr: atr,
                price: latestPrice,
                data: data
            };
        },

        structure(data) {
            if (!data || data.length < 10) return "WAITING";

            const recent = data.slice(-10);

            const highs = recent.map(x => x.high);
            const lows = recent.map(x => x.low);

            const highNow = Math.max(...highs.slice(-5));
            const highBefore = Math.max(...highs.slice(0, 5));

            const lowNow = Math.min(...lows.slice(-5));
            const lowBefore = Math.min(...lows.slice(0, 5));

            if (highNow > highBefore && lowNow > lowBefore) {
                return "BULLISH STRUCTURE";
            }

            if (highNow < highBefore && lowNow < lowBefore) {
                return "BEARISH STRUCTURE";
            }

            return "RANGE / MIXED";
        },

        liquidity(data) {
            if (!data || data.length < 10) return "WAITING";

            const recent = data.slice(-10);
            const latest = recent[recent.length - 1];
            const previous = recent.slice(0, -1);

            const previousHigh =
                Math.max(...previous.map(x => x.high));

            const previousLow =
                Math.min(...previous.map(x => x.low));

            if (latest.high > previousHigh &&
                latest.close < previousHigh) {
                return "POSSIBLE HIGH SWEEP";
            }

            if (latest.low < previousLow &&
                latest.close > previousLow) {
                return "POSSIBLE LOW SWEEP";
            }

            return "NO CLEAR SWEEP";
        },

        fvg(data) {
            if (!data || data.length < 3) return "WAITING";

            const a = data[data.length - 3];
            const c = data[data.length - 1];

            if (c.low > a.high) return "BULLISH GAP";
            if (c.high < a.low) return "BEARISH GAP";

            return "NO CLEAR FVG";
        },

        orderBlock(data) {
            if (!data || data.length < 5) return "WAITING";

            const latest = data[data.length - 1];
            const previous = data[data.length - 2];

            if (latest.close > previous.high) {
                return "BULLISH BREAK";
            }

            if (latest.close < previous.low) {
                return "BEARISH BREAK";
            }

            return "NO CONFIRMED BREAK";
        }
    };

    /* =====================================================
       SIGNAL DISPLAY
    ===================================================== */

    function clearSignal(reason) {
        setText("aiSignal", "WAIT", "#d9b45b");
        setText("signalStrength", reason || "WAITING", "#d9b45b");
        setText("signalEMA", "--");
        setText("signalRSI", "--");
        setText("signalTF", currentTimeframe.toUpperCase());
        setText("signalUpdated", "--");

        setText("structure", "WAITING");
        setText("liquidity", "WAITING");
        setText("fvg", "WAITING");
        setText("orderBlock", "WAITING");

        setText("entry", "--");
        setText("stopLoss", "--");
        setText("tp1", "--");
        setText("tp2", "--");
        setText("tp3", "--");

        const meter = document.getElementById("signalMeterFill");

        if (meter) {
            meter.style.width = "0%";
        }
    }

    function analyseCurrent() {
        if (!candles.length) {
            clearSignal("WAITING FOR DATA");
            return;
        }

        const result = Analysis.analyse(candles);

        if (!result.ready) {
            clearSignal(result.reason);
            return;
        }

        let signalColor = "#d9b45b";

        if (result.signal === "BUY") signalColor = "#00c087";
        if (result.signal === "SELL") signalColor = "#f6465d";

        setText("aiSignal", result.signal, signalColor);
        setText("signalStrength", result.strength + "%", signalColor);

        setText(
            "signalEMA",
            result.ema9 > result.ema20 ? "BULLISH" : "BEARISH",
            result.ema9 > result.ema20 ? "#00c087" : "#f6465d"
        );

        setText("signalRSI", result.rsi.toFixed(2));
        setText("signalTF", currentTimeframe.toUpperCase());

        setText(
            "signalUpdated",
            "UPDATED " + new Date().toLocaleTimeString()
        );

        const meter =
            document.getElementById("signalMeterFill");

        if (meter) {
            meter.style.width = result.strength + "%";
            meter.style.background = signalColor;
        }

        setText("structure", Analysis.structure(candles));
        setText("liquidity", Analysis.liquidity(candles));
        setText("fvg", Analysis.fvg(candles));
        setText("orderBlock", Analysis.orderBlock(candles));

        updateLevels(result);
    }

    function updateLevels(result) {
        if (!result || !result.ready) return;

        const price = result.price;
        const atr = result.atr;

        if (!Number.isFinite(price) ||
            !Number.isFinite(atr) || atr <= 0) {
            return;
        }

        if (result.signal === "WAIT") {
            setText("entry", "--");
            setText("stopLoss", "--");
            setText("tp1", "--");
            setText("tp2", "--");
            setText("tp3", "--");
            return;
        }

        const isBuy = result.signal === "BUY";

        const stop = isBuy
            ? price - atr * 1.5
            : price + atr * 1.5;

        const tp1 = isBuy
            ? price + atr
            : price - atr;

        const tp2 = isBuy
            ? price + atr * 2
            : price - atr * 2;

        const tp3 = isBuy
            ? price + atr * 3
            : price - atr * 3;

        setText("entry", price.toFixed(2));
        setText("stopLoss", stop.toFixed(2), "#f6465d");
        setText("tp1", tp1.toFixed(2), "#00c087");
        setText("tp2", tp2.toFixed(2), "#00c087");
        setText("tp3", tp3.toFixed(2), "#00c087");
    }

    /* =====================================================
       MULTI TIMEFRAME ENGINE
    ===================================================== */

    function updateMtfRow(timeframe, result) {
        const elementId = MTF_ELEMENTS[timeframe];
        const element = document.getElementById(elementId);

        if (!element) return;

        if (!result || !result.ready) {
            element.textContent = "WAITING";
            element.style.color = "#d9b45b";
            return;
        }

        element.textContent =
            result.signal + " (" + result.strength + "%)";

        element.style.color =
            result.signal === "BUY"
                ? "#00c087"
                : result.signal === "SELL"
                    ? "#f6465d"
                    : "#d9b45b";
    }

    async function refreshMTF(force = false) {
        if (mtfLoading) return;

        if (!force &&
            Date.now() - lastMtfUpdate < MTF_REFRESH_MS) {
            return;
        }

        mtfLoading = true;
        setText("mtfUpdated", "UPDATING...");

        const frames = Object.keys(TIMEFRAMES);
        let successCount = 0;

        try {
            for (const timeframe of frames) {
                try {
                    const data = await queueRequest(
                        () => Market.request(timeframe)
                    );

                    const analysis = Analysis.analyse(data);

                    mtfCache[timeframe] = {
                        result: analysis,
                        updatedAt: Date.now()
                    };

                    updateMtfRow(timeframe, analysis);
                    successCount++;

                } catch (error) {
                    console.error(
                        "ADLI MTF ERROR:",
                        timeframe,
                        error.message
                    );

                    // Preserve last known result but mark it stale.
                    const cached = mtfCache[timeframe];

                    if (cached) {
                        const element = document.getElementById(
                            MTF_ELEMENTS[timeframe]
                        );

                        if (element) {
                            element.textContent =
                                cached.result.signal + " (STALE)";
                            element.style.color = "#d9b45b";
                        }
                    } else {
                        updateMtfRow(timeframe, null);
                    }
                }
            }

            lastMtfUpdate = Date.now();

            setText(
                "mtfUpdated",
                successCount + "/7 UPDATED " +
                new Date().toLocaleTimeString()
            );

        } finally {
            mtfLoading = false;
        }
    }

    /* =====================================================
       TIMEFRAME CONTROLS
    ===================================================== */

    function setupTimeframes() {
        document.querySelectorAll("[data-tf]").forEach(button => {
            button.addEventListener("click", () => {
                document.querySelectorAll("[data-tf]").forEach(item => {
                    item.classList.remove("active");
                });

                button.classList.add("active");

                const timeframe = button.dataset.tf;

                if (TIMEFRAMES[timeframe]) {
                    Market.setTimeframe(timeframe);
                }
            });
        });
    }

    /* =====================================================
       START ENGINE
    ===================================================== */

    function start() {
        if (started) return;
        started = true;

        Market.initChart();
        setupTimeframes();

        // Start chart request first.
        Market.fetch(currentTimeframe);

        // MTF calls are queued and spaced apart.
        refreshMTF(true);

        refreshTimer = setInterval(() => {
            Market.fetch(currentTimeframe);
        }, REFRESH_MS);

        mtfTimer = setInterval(() => {
            refreshMTF(false);
        }, MTF_REFRESH_MS);

        console.log("ADLI FX INTEL APP ENGINE V2.1 READY.");
    }

    /* =====================================================
       PUBLIC API
    ===================================================== */

    window.ADLI_MARKET = Market;
    window.ADLI_ANALYSIS = Analysis;

    window.ADLI_APP = {
        resizeChart: () => Market.resizeChart(),

        refresh: () => Market.fetch(currentTimeframe),

        refreshMTF: () => refreshMTF(true),

        getTimeframe: () => currentTimeframe,

        getCandles: () => Market.getCandles(),

        getPrice: () => Market.getPrice(),

        getStatus: () => Market.getStatus(),

        getError: () => lastChartError,

        getMtfCache: () => mtfCache
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start, {
            once: true
        });
    } else {
        start();
    }

})();
