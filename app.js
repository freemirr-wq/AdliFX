/* =========================================================
   ADLI FX INTEL INDICATOR
   APP ENGINE V2.0
   Twelve Data + Supabase + Lightweight Charts
   Technical rule-based analysis — not machine learning
========================================================= */

(function () {
    "use strict";

    const CONFIG = window.ADLI_CONFIG;

    if (!CONFIG) {
        console.error("ADLI: config.js is missing.");
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

    const REFRESH_MS = 120000;
    const MTF_REFRESH_MS = 30 * 60 * 1000;
    const MTF_DELAY_MS = 10000;

    let currentTimeframe = "5m";
    let candles = [];
    let chart = null;
    let candleSeries = null;

    let chartLoading = false;
    let mtfLoading = false;

    let refreshTimer = null;
    let mtfTimer = null;

    let lastMtfUpdate = 0;
    let mtfCache = {};

    let resizeObserver = null;

    const Market = {
        status: "WAITING",
        price: null,
        lastUpdated: null,
        error: null,

        initChart() {
            const container =
                document.getElementById("priceChart");

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
                },

                localization: {
                    priceFormatter: price =>
                        Number(price).toFixed(2)
                }
            });

            candleSeries = chart.addCandlestickSeries({
                upColor: "#00c087",
                downColor: "#f6465d",
                borderUpColor: "#00c087",
                borderDownColor: "#f6465d",
                wickUpColor: "#00c087",
                wickDownColor: "#f6465d",
                priceLineVisible: true
            });

            if (window.ResizeObserver) {
                resizeObserver = new ResizeObserver(() => {
                    this.resizeChart();
                });

                resizeObserver.observe(container);
            }

            window.addEventListener("resize", () => {
                this.resizeChart();
            });
        },

        convertCandles(values) {
            if (!Array.isArray(values)) return [];

            return values
                .map(item => {
                    const dateString =
                        String(item.datetime || "").replace(" ", "T");

                    const timestamp =
                        new Date(dateString + "Z").getTime();

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
                    Number.isFinite(item.close)
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
                throw new Error("Market data is disabled in config.js.");
            }

            if (!FUNCTION_URL || !API_KEY) {
                throw new Error("Supabase market data configuration is missing.");
            }

            const params = new URLSearchParams({
                symbol: SYMBOL,
                interval: TIMEFRAMES[timeframe]
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

            let result;

            try {
                result = await response.json();
            } catch (error) {
                throw new Error("Market data response is not valid JSON.");
            }

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

            if (!converted.length) {
                throw new Error("Candle data format is invalid.");
            }

            return converted;
        },

        async fetch(timeframe = currentTimeframe) {
            if (chartLoading) return;

            chartLoading = true;
            this.status = "LOADING";
            this.updateUI();

            try {
                const received = await this.request(timeframe);

                candles = received;
                currentTimeframe = timeframe;

                this.price = candles[candles.length - 1].close;
                this.lastUpdated = new Date();
                this.status = "CONNECTED";
                this.error = null;

                if (candleSeries && chart) {
                    candleSeries.setData(candles);
                    chart.timeScale().fitContent();
                }

                this.updateUI();
                this.analyseCurrent();

                console.log("ADLI MARKET DATA:", {
                    symbol: SYMBOL,
                    timeframe: timeframe,
                    candleCount: candles.length,
                    price: this.price
                });

            } catch (error) {
                this.status = "ERROR";
                this.error = error.message;

                console.error("ADLI MARKET ERROR:", error);

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
                        ? this.price.toFixed(2)
                        : "--";
            }

            if (statusElement) {
                statusElement.textContent = this.status;

                statusElement.style.color =
                    this.status === "CONNECTED"
                        ? "#00c087"
                        : this.status === "LOADING"
                            ? "#d9b45b"
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
       TECHNICAL ANALYSIS ENGINE
    ===================================================== */

    const Analysis = {

        ema(values, period) {
            if (!Array.isArray(values) ||
                values.length < period) {
                return null;
            }

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
                values.length <= period) {
                return null;
            }

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

                const gain = Math.max(change, 0);
                const loss = Math.max(-change, 0);

                averageGain =
                    (averageGain * (period - 1) + gain) / period;

                averageLoss =
                    (averageLoss * (period - 1) + loss) / period;
            }

            if (averageLoss === 0) return 100;

            const rs = averageGain / averageLoss;

            return 100 - (100 / (1 + rs));
        },

        atr(data, period = 14) {
            if (!Array.isArray(data) ||
                data.length <= period) {
                return null;
            }

            const ranges = [];

            for (let i = 1; i < data.length; i++) {
                const current = data[i];
                const previous = data[i - 1];

                const tr = Math.max(
                    current.high - current.low,
                    Math.abs(current.high - previous.close),
                    Math.abs(current.low - previous.close)
                );

                ranges.push(tr);
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

            if (ema9 === null ||
                ema20 === null ||
                rsi === null) {
                return {
                    ready: false,
                    signal: "WAIT",
                    strength: 0,
                    reason: "Indicator calculation unavailable"
                };
            }

            let score = 0;

            if (ema9 > ema20) score += 2;
            if (ema9 < ema20) score -= 2;

            if (closes[closes.length - 1] > ema20) score += 1;
            if (closes[closes.length - 1] < ema20) score -= 1;

            if (rsi >= 55 && rsi < 75) score += 1;
            if (rsi <= 45 && rsi > 25) score -= 1;

            let signal = "WAIT";

            if (score >= 3) signal = "BUY";
            if (score <= -3) signal = "SELL";

            const strength = Math.min(
                100,
                Math.round(Math.abs(score) / 4 * 100)
            );

            return {
                ready: true,
                signal: signal,
                strength: strength,
                score: score,
                ema9: ema9,
                ema20: ema20,
                rsi: rsi,
                atr: atr,
                price: closes[closes.length - 1],
                closes: closes,
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

            if (c.low > a.high) {
                return "BULLISH GAP";
            }

            if (c.high < a.low) {
                return "BEARISH GAP";
            }

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

    function setText(id, value, color) {
        const element = document.getElementById(id);

        if (!element) return;

        element.textContent = value;

        if (color) {
            element.style.color = color;
        }
    }

    function analyseCurrent() {
        if (!candles.length) return;

        const result = Analysis.analyse(candles);

        if (!result.ready) {
            setText("aiSignal", "WAIT");
            setText("signalStrength", result.reason);
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
            !Number.isFinite(atr) ||
            atr <= 0) {
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

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function updateMtfRow(timeframe, result) {
        const elementId = MTF_ELEMENTS[timeframe];
        const element = document.getElementById(elementId);

        if (!element) return;

        if (!result || !result.ready) {
            element.textContent = "INSUFFICIENT DATA";
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

        const now = Date.now();

        if (!force &&
            now - lastMtfUpdate < MTF_REFRESH_MS) {
            return;
        }

        mtfLoading = true;

        setText("mtfUpdated", "UPDATING...");

        const frames = Object.keys(TIMEFRAMES);

        try {
            for (let i = 0; i < frames.length; i++) {
                const timeframe = frames[i];

                try {
                    const data = await Market.request(timeframe);
                    const analysis = Analysis.analyse(data);

                    mtfCache[timeframe] = {
                        result: analysis,
                        updatedAt: Date.now()
                    };

                    updateMtfRow(timeframe, analysis);

                } catch (error) {
                    console.error(
                        "ADLI MTF ERROR:",
                        timeframe,
                        error.message
                    );

                    updateMtfRow(timeframe, null);
                }

                if (i < frames.length - 1) {
                    await sleep(MTF_DELAY_MS);
                }
            }

            lastMtfUpdate = Date.now();

            setText(
                "mtfUpdated",
                "UPDATED " + new Date().toLocaleTimeString()
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

                window.dispatchEvent(
                    new CustomEvent("adli:timeframe-change", {
                        detail: {
                            timeframe: button.dataset.tf
                        }
                    })
                );
            });
        });

        window.addEventListener(
            "adli:timeframe-change",
            event => {
                if (event.detail &&
                    TIMEFRAMES[event.detail.timeframe]) {
                    Market.setTimeframe(event.detail.timeframe);
                }
            }
        );
    }

    /* =====================================================
       START ENGINE
    ===================================================== */

    function start() {
        Market.initChart();
        setupTimeframes();

        Market.fetch(currentTimeframe);

        refreshMTF(true);

        refreshTimer = setInterval(() => {
            Market.fetch(currentTimeframe);
        }, REFRESH_MS);

        mtfTimer = setInterval(() => {
            refreshMTF(false);
        }, MTF_REFRESH_MS);

        console.log("ADLI FX INTEL INDICATOR V2.0 READY.");
    }

    window.ADLI_MARKET = Market;
    window.ADLI_ANALYSIS = Analysis;

    window.ADLI_APP = {
        resizeChart: () => Market.resizeChart(),

        refresh: () => Market.fetch(currentTimeframe),

        refreshMTF: () => refreshMTF(true),

        getTimeframe: () => currentTimeframe,

        getCandles: () => Market.getCandles(),

        getPrice: () => Market.getPrice(),

        getStatus: () => Market.getStatus()
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }

})();
