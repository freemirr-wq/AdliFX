/* =========================================================
   ADLI FX INTEL V6
   PREMIUM MARKET TERMINAL
   XAUUSD | MULTI-TIMEFRAME | TECHNICAL STUDY

   Data source : Supabase Edge Function
   Function    : market-data
   Chart       : Lightweight Charts 4.2

   Educational technical analysis only.
========================================================= */

(() => {
"use strict";

/* =========================================================
   01 | CONFIGURATION
========================================================= */

const CONFIG = window.ADLI_CONFIG || {};

const SUPABASE_URL = CONFIG.SUPABASE_URL;
const SUPABASE_KEY = CONFIG.SUPABASE_KEY;

const FUNCTION_URL = SUPABASE_URL
    ? SUPABASE_URL.replace(/\/$/, "") + "/functions/v1/market-data"
    : "";

const SYMBOL = "XAU/USD";

const REFRESH_INTERVAL = 300000;
const REQUEST_GAP = 8000;

const TIMEFRAMES = {
    "1m": "1min",
    "5m": "5min",
    "15m": "15min",
    "30m": "30min",
    "1h": "1h",
    "4h": "4h",
    "1d": "1day"
};

const TF_LABELS = {
    "1m": "M1",
    "5m": "M5",
    "15m": "M15",
    "30m": "M30",
    "1h": "H1",
    "4h": "H4",
    "1d": "D1"
};

const COLORS = {
    gold: "#d8b45b",
    green: "#00c58a",
    red: "#f05262",
    blue: "#5a9cff",
    text: "#dce1e8",
    muted: "#89919d"
};

let currentTF = "5m";
let currentMode = "scalping";
let currentLanguage = localStorage.getItem("adli_language") || "ms";

let chart = null;
let candleSeries = null;
let zoneOverlay = null;

let latestAnalysis = null;
let latestCandles = [];
let latestPrice = null;

let requestBusy = false;
let lastRequestTime = 0;
let refreshTimer = null;

let currentLevels = {};
let history = [];

let mtfCache = {};
let mtfBusy = false;

window.ADLI_LANG = currentLanguage;


/* =========================================================
   02 | UTILITIES
========================================================= */

const $ = id => document.getElementById(id);

function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
}

function setHTML(id, value) {
    const el = $(id);
    if (el) el.innerHTML = value;
}

function formatPrice(value) {
    if (!Number.isFinite(Number(value))) return "--";

    return Number(value).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function average(values) {
    if (!values.length) return 0;

    return values.reduce((a, b) => a + b, 0) / values.length;
}

function safeNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function setStatus(message, color) {
    const el = $("dataStatus");

    if (el) {
        el.textContent = message;
        if (color) el.style.color = color;
    }

    setText("dataStatusMirror", message);
}

function nowString() {
    return new Date().toLocaleTimeString("en-MY", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "Asia/Kuala_Lumpur"
    });
}

function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[char]);
}


/* =========================================================
   03 | HISTORY
========================================================= */

function loadHistory() {
    try {
        history = JSON.parse(
            localStorage.getItem("adli_fx_history") || "[]"
        );
    } catch (error) {
        history = [];
    }

    renderHistory();
}

function saveHistory(result) {
    if (!result || !result.signal) return;

    const item = {
        time: new Date().toLocaleString("en-MY"),
        mode: currentMode.toUpperCase(),
        timeframe: currentTF.toUpperCase(),
        signal: result.signal,
        score: result.score,
        price: result.price
    };

    const last = history[0];

    if (
        last &&
        last.signal === item.signal &&
        last.timeframe === item.timeframe &&
        last.price === item.price
    ) {
        return;
    }

    history.unshift(item);
    history = history.slice(0, 50);

    localStorage.setItem(
        "adli_fx_history",
        JSON.stringify(history)
    );

    renderHistory();
}

function renderHistory() {
    const body = $("historyBody");
    if (!body) return;

    if (!history.length) {
        body.innerHTML =
            '<tr><td colspan="6" class="empty">Belum ada rekod.</td></tr>';
        return;
    }

    body.innerHTML = history.map(item => `
        <tr>
            <td>${escapeHTML(item.time)}</td>
            <td>${escapeHTML(item.mode)}</td>
            <td>${escapeHTML(item.timeframe)}</td>
            <td>${escapeHTML(item.signal)}</td>
            <td>${escapeHTML(item.score)}%</td>
            <td>${escapeHTML(formatPrice(item.price))}</td>
        </tr>
    `).join("");
}

function clearHistory() {
    if (!confirm("Padam semua sejarah bacaan pada peranti ini?")) {
        return;
    }

    history = [];
    localStorage.removeItem("adli_fx_history");
    renderHistory();
}


/* =========================================================
   04 | CHART INITIALIZATION
========================================================= */

function initChart() {
    const container = $("priceChart");

    if (!container || !window.LightweightCharts) {
        console.error("Chart library atau container tidak tersedia.");
        return;
    }

    if (chart) return;

    chart = LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: container.clientHeight,

        layout: {
            background: {
                type: "solid",
                color: "#101318"
            },
            textColor: "#9ca5b1",
            fontFamily: "Inter, Arial, sans-serif"
        },

        grid: {
            vertLines: {
                color: "#252b33"
            },
            horzLines: {
                color: "#252b33"
            }
        },

        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
            vertLine: {
                color: "#8d7747",
                width: 1,
                style: LightweightCharts.LineStyle.Dashed,
                labelBackgroundColor: "#8d7747"
            },
            horzLine: {
                color: "#8d7747",
                width: 1,
                style: LightweightCharts.LineStyle.Dashed,
                labelBackgroundColor: "#8d7747"
            }
        },

        rightPriceScale: {
            borderColor: "#343b45",
            scaleMargins: {
                top: 0.12,
                bottom: 0.12
            }
        },

        timeScale: {
            borderColor: "#343b45",
            timeVisible: true,
            secondsVisible: false,
            rightOffset: 5
        },

        handleScroll: {
            mouseWheel: true,
            pressedMouseMove: true,
            horzTouchDrag: true,
            vertTouchDrag: false
        },

        handleScale: {
            mouseWheel: true,
            pinch: true,
            axisPressedMouseMove: true
        }
    });

    candleSeries = chart.addCandlestickSeries({
        upColor: COLORS.green,
        downColor: COLORS.red,
        borderUpColor: COLORS.green,
        borderDownColor: COLORS.red,
        wickUpColor: COLORS.green,
        wickDownColor: COLORS.red,
        priceLineVisible: true,
        lastValueVisible: true
    });

    createZoneOverlay();

    chart.timeScale().subscribeVisibleTimeRangeChange(
        updateZoneOverlay
    );

    window.addEventListener("resize", resizeChart);

    setTimeout(resizeChart, 250);
}

function resizeChart() {
    if (!chart) return;

    const container = $("priceChart");
    if (!container) return;

    chart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight
    });

    updateZoneOverlay();
}


/* =========================================================
   05 | BUY / SELL ZONE OVERLAY
========================================================= */

function createZoneOverlay() {
    const container = $("priceChart");
    if (!container || zoneOverlay) return;

    zoneOverlay = document.createElement("div");

    zoneOverlay.id = "adliZoneOverlay";

    zoneOverlay.style.cssText = `
        position:absolute;
        inset:0;
        pointer-events:none;
        z-index:3;
        overflow:hidden;
    `;

    container.appendChild(zoneOverlay);
}

function makeZoneElement(type) {
    const el = document.createElement("div");

    const isBuy = type === "buy";

    el.style.cssText = `
        position:absolute;
        left:5px;
        right:68px;
        border-top:1px dashed ${isBuy ? COLORS.green : COLORS.red};
        border-bottom:1px dashed ${isBuy ? COLORS.green : COLORS.red};
        background:${isBuy
            ? "rgba(0,197,138,0.12)"
            : "rgba(240,82,98,0.12)"};
        display:none;
    `;

    const label = document.createElement("span");

    label.textContent = isBuy ? "BUY ZONE" : "SELL ZONE";

    label.style.cssText = `
        position:absolute;
        left:7px;
        top:3px;
        font-size:9px;
        font-weight:900;
        letter-spacing:1px;
        color:${isBuy ? COLORS.green : COLORS.red};
        text-shadow:0 1px 3px #000;
    `;

    el.appendChild(label);

    return el;
}

function ensureZoneElements() {
    if (!zoneOverlay) return;

    if (!zoneOverlay.querySelector(".adli-buy-zone")) {
        const buy = makeZoneElement("buy");
        buy.classList.add("adli-buy-zone");
        zoneOverlay.appendChild(buy);
    }

    if (!zoneOverlay.querySelector(".adli-sell-zone")) {
        const sell = makeZoneElement("sell");
        sell.classList.add("adli-sell-zone");
        zoneOverlay.appendChild(sell);
    }
}

function updateZoneOverlay() {
    if (!chart || !candleSeries || !zoneOverlay) return;
    if (!currentLevels.buy || !currentLevels.sell) return;

    ensureZoneElements();

    const buyEl = zoneOverlay.querySelector(".adli-buy-zone");
    const sellEl = zoneOverlay.querySelector(".adli-sell-zone");

    const buyTop = candleSeries.priceToCoordinate(
        currentLevels.buy.high
    );

    const buyBottom = candleSeries.priceToCoordinate(
        currentLevels.buy.low
    );

    const sellTop = candleSeries.priceToCoordinate(
        currentLevels.sell.high
    );

    const sellBottom = candleSeries.priceToCoordinate(
        currentLevels.sell.low
    );

    function position(el, a, b) {
        if (
            a === null || b === null ||
            !Number.isFinite(a) || !Number.isFinite(b)
        ) {
            el.style.display = "none";
            return;
        }

        const top = Math.min(a, b);
        const bottom = Math.max(a, b);

        el.style.display = "block";
        el.style.top = top + "px";
        el.style.height = Math.max(4, bottom - top) + "px";
    }

    position(buyEl, buyTop, buyBottom);
    position(sellEl, sellTop, sellBottom);
}

function clearPriceLines() {
    if (!candleSeries || !currentLevels.lines) return;

    currentLevels.lines.forEach(line => {
        try {
            candleSeries.removePriceLine(line);
        } catch (error) {}
    });

    currentLevels.lines = [];
}

function addPriceLine(price, title, color, style) {
    if (!candleSeries || !Number.isFinite(price)) return;

    const line = candleSeries.createPriceLine({
        price,
        color,
        lineWidth: 1,
        lineStyle: style || LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title
    });

    currentLevels.lines.push(line);
}


/* =========================================================
   06 | DATA FETCH
========================================================= */

async function fetchMarketData(timeframe) {
    if (!FUNCTION_URL || !SUPABASE_KEY) {
        throw new Error(
            "Supabase configuration tidak lengkap. Semak config.js."
        );
    }

    const interval = TIMEFRAMES[timeframe];

    if (!interval) {
        throw new Error("Timeframe tidak sah.");
    }

    const response = await fetch(FUNCTION_URL, {
        method: "POST",

        headers: {
            "Content-Type": "application/json",
            "apikey": SUPABASE_KEY,
            "Authorization": "Bearer " + SUPABASE_KEY
        },

        body: JSON.stringify({
            symbol: SYMBOL,
            interval: interval,
            outputsize: 250
        })
    });

    let data;

    try {
        data = await response.json();
    } catch (error) {
        throw new Error("Respons server bukan JSON yang sah.");
    }

    if (!response.ok) {
        throw new Error(
            data.message ||
            data.error ||
            "Market data request failed: " + response.status
        );
    }

    if (data.success === false) {
        throw new Error(
            data.message || data.error || "Market data tidak berjaya."
        );
    }

    const values =
        data.values ||
        data.data?.values ||
        data.data ||
        [];

    if (!Array.isArray(values) || !values.length) {
        throw new Error("Tiada candle diterima daripada server.");
    }

    return values;
}

function normalizeCandles(values) {
    const output = [];

    values.forEach(item => {
        const open = safeNumber(item.open);
        const high = safeNumber(item.high);
        const low = safeNumber(item.low);
        const close = safeNumber(item.close);

        if (
            open === null ||
            high === null ||
            low === null ||
            close === null
        ) return;

        let time = item.datetime || item.date || item.time;

        if (typeof time === "string") {
            const parsed = Date.parse(time);

            if (!Number.isFinite(parsed)) return;

            time = Math.floor(parsed / 1000);
        } else {
            time = Number(time);

            if (time > 1000000000000) {
                time = Math.floor(time / 1000);
            }
        }

        if (!Number.isFinite(time)) return;

        output.push({
            time,
            open,
            high,
            low,
            close
        });
    });

    output.sort((a, b) => a.time - b.time);

    const unique = [];

    output.forEach(candle => {
        const last = unique[unique.length - 1];

        if (last && last.time === candle.time) {
            unique[unique.length - 1] = candle;
        } else {
            unique.push(candle);
        }
    });

    return unique;
}


/* =========================================================
   07 | TECHNICAL INDICATORS
========================================================= */

function calculateEMA(values, period) {
    if (!values.length) return [];

    const multiplier = 2 / (period + 1);
    const result = [];

    let ema = values[0];

    values.forEach((value, index) => {
        if (index === 0) {
            ema = value;
        } else {
            ema = (value - ema) * multiplier + ema;
        }

        result.push(ema);
    });

    return result;
}

function calculateRSI(values, period = 14) {
    if (values.length <= period) return 50;

    let gain = 0;
    let loss = 0;

    for (let i = values.length - period; i < values.length; i++) {
        const change = values[i] - values[i - 1];

        if (change > 0) gain += change;
        else loss += Math.abs(change);
    }

    const avgGain = gain / period;
    const avgLoss = loss / period;

    if (avgLoss === 0) return 100;

    const rs = avgGain / avgLoss;

    return 100 - (100 / (1 + rs));
}

function calculateATR(candles, period = 14) {
    if (candles.length < period + 1) return 0;

    const ranges = [];

    for (let i = 1; i < candles.length; i++) {
        const current = candles[i];
        const previous = candles[i - 1];

        const tr = Math.max(
            current.high - current.low,
            Math.abs(current.high - previous.close),
            Math.abs(current.low - previous.close)
        );

        ranges.push(tr);
    }

    return average(ranges.slice(-period));
}


/* =========================================================
   08 | ANALYSIS ENGINE
========================================================= */

function analyzeMarket(candles) {
    if (candles.length < 30) {
        throw new Error("Data candle belum mencukupi untuk analisis.");
    }

    const closes = candles.map(c => c.close);

    const ema9 = calculateEMA(closes, 9);
    const ema20 = calculateEMA(closes, 20);
    const ema50 = calculateEMA(closes, 50);

    const rsi = calculateRSI(closes, 14);
    const atr = calculateATR(candles, 14);

    const last = candles[candles.length - 1];
    const previous = candles[candles.length - 2];

    const e9 = ema9[ema9.length - 1];
    const e20 = ema20[ema20.length - 1];
    const e50 = ema50[ema50.length - 1];

    let buyScore = 0;
    let sellScore = 0;

    if (e9 > e20) buyScore += 25;
    if (e9 < e20) sellScore += 25;

    if (e20 > e50) buyScore += 20;
    if (e20 < e50) sellScore += 20;

    if (last.close > e20) buyScore += 15;
    if (last.close < e20) sellScore += 15;

    if (rsi > 52 && rsi < 70) buyScore += 20;
    if (rsi < 48 && rsi > 30) sellScore += 20;

    if (last.close > previous.close) buyScore += 10;
    if (last.close < previous.close) sellScore += 10;

    if (last.close > e50) buyScore += 10;
    if (last.close < e50) sellScore += 10;

    let signal = "HOLD";
    let score = Math.max(buyScore, sellScore);

    if (buyScore >= 65 && buyScore > sellScore) {
        signal = "BUY BIAS";
    } else if (sellScore >= 65 && sellScore > buyScore) {
        signal = "SELL BIAS";
    }

    const recent = candles.slice(-30);

    const recentHigh = Math.max(...recent.map(c => c.high));
    const recentLow = Math.min(...recent.map(c => c.low));

    const midpoint = (recentHigh + recentLow) / 2;

    const buyLow = last.close - atr * 0.8;
    const buyHigh = last.close - atr * 0.2;

    const sellLow = last.close + atr * 0.2;
    const sellHigh = last.close + atr * 0.8;

    let structure = "RANGE / CONSOLIDATION";

    if (last.close > recentHigh - atr * 0.15) {
        structure = "POTENTIAL BULLISH BREAK";
    } else if (last.close < recentLow + atr * 0.15) {
        structure = "POTENTIAL BEARISH BREAK";
    } else if (last.close > midpoint) {
        structure = "PRICE ABOVE MID-RANGE";
    } else {
        structure = "PRICE BELOW MID-RANGE";
    }

    let liquidity = "NO CLEAR SWEEP";

    if (last.high > previous.high && last.close < previous.high) {
        liquidity = "POSSIBLE BUY-SIDE SWEEP";
    } else if (last.low < previous.low && last.close > previous.low) {
        liquidity = "POSSIBLE SELL-SIDE SWEEP";
    }

    let fvg = "NO CLEAR FVG";

    if (candles.length >= 3) {
        const a = candles[candles.length - 3];
        const c = candles[candles.length - 1];

        if (c.low > a.high) {
            fvg = "POTENTIAL BULLISH GAP";
        } else if (c.high < a.low) {
            fvg = "POTENTIAL BEARISH GAP";
        }
    }

    let orderBlock = "NO CLEAR OB PROXY";

    const previousMove = last.close - previous.close;

    if (previousMove > atr * 0.5) {
        orderBlock = "BULLISH MOMENTUM CANDLE";
    } else if (previousMove < -atr * 0.5) {
        orderBlock = "BEARISH MOMENTUM CANDLE";
    }

    const premiumDiscount =
        last.close > midpoint
        ? "PREMIUM HALF"
        : "DISCOUNT HALF";

    return {
        price: last.close,
        signal,
        score,
        buyScore,
        sellScore,
        ema9: e9,
        ema20: e20,
        ema50: e50,
        rsi,
        atr,
        structure,
        liquidity,
        fvg,
        orderBlock,
        premiumDiscount,
        recentHigh,
        recentLow,
        midpoint,
        buy: {
            low: buyLow,
            high: buyHigh
        },
        sell: {
            low: sellLow,
            high: sellHigh
        }
    };
}


/* =========================================================
   09 | ENTRY / SL / TP LEVELS
========================================================= */

function calculateLevels(result) {
    const price = result.price;
    const atr = result.atr;

    let direction = 0;

    if (result.signal === "BUY BIAS") direction = 1;
    if (result.signal === "SELL BIAS") direction = -1;

    if (direction === 0) {
        direction = result.buyScore >= result.sellScore ? 1 : -1;
    }

    const entry = price;

    let stopLoss;
    let tp1;
    let tp2;
    let tp3;

    if (direction === 1) {
        stopLoss = entry - atr * 1.5;
        tp1 = entry + atr;
        tp2 = entry + atr * 2;
        tp3 = entry + atr * 3;
    } else {
        stopLoss = entry + atr * 1.5;
        tp1 = entry - atr;
        tp2 = entry - atr * 2;
        tp3 = entry - atr * 3;
    }

    return {
        direction,
        entry,
        stopLoss,
        tp1,
        tp2,
        tp3,
        buy: result.buy,
        sell: result.sell
    };
}

function renderLevels(result) {
    const levels = calculateLevels(result);

    currentLevels = {
        ...levels,
        lines: currentLevels.lines || []
    };

    setText("entry", formatPrice(levels.entry));
    setText("stopLoss", formatPrice(levels.stopLoss));
    setText("tp1", formatPrice(levels.tp1));
    setText("tp2", formatPrice(levels.tp2));
    setText("tp3", formatPrice(levels.tp3));

    setText(
        "buyZone",
        formatPrice(levels.buy.low) + " – " + formatPrice(levels.buy.high)
    );

    setText(
        "sellZone",
        formatPrice(levels.sell.low) + " – " + formatPrice(levels.sell.high)
    );

    setText(
        "buyZoneStatus",
        result.price >= levels.buy.low && result.price <= levels.buy.high
            ? "PRICE INSIDE ZONE"
            : "WAITING / OUTSIDE"
    );

    setText(
        "sellZoneStatus",
        result.price >= levels.sell.low && result.price <= levels.sell.high
            ? "PRICE INSIDE ZONE"
            : "WAITING / OUTSIDE"
    );

    clearPriceLines();

    addPriceLine(levels.entry, "ENTRY", COLORS.gold);
    addPriceLine(levels.stopLoss, "SL", COLORS.red);
    addPriceLine(levels.tp1, "TP1", COLORS.green);
    addPriceLine(levels.tp2, "TP2", COLORS.green);
    addPriceLine(levels.tp3, "TP3", COLORS.green);

    updateZoneOverlay();
}


/* =========================================================
   10 | DASHBOARD RENDER
========================================================= */

function renderAnalysis(result) {
    latestAnalysis = result;
    latestPrice = result.price;

    setText("goldPrice", formatPrice(result.price));

    setText(
        "marketTrend",
        result.signal === "BUY BIAS"
            ? "▲ BULLISH BIAS"
            : result.signal === "SELL BIAS"
                ? "▼ BEARISH BIAS"
                : "● NEUTRAL"
    );

    setText("signalTF", TF_LABELS[currentTF]);

    const signalEl = $("aiSignal");

    if (signalEl) {
        signalEl.textContent = result.signal;

        signalEl.style.color =
            result.signal === "BUY BIAS"
                ? COLORS.green
                : result.signal === "SELL BIAS"
                    ? COLORS.red
                    : COLORS.gold;
    }

    setText("signalStrength", "Technical score: " + result.score + "%");

    const meter = $("signalMeterFill");

    if (meter) {
        meter.style.width = Math.min(100, result.score) + "%";
    }

    setText("signalUpdated", nowString());

    setText(
        "signalEMA",
        formatPrice(result.ema9) + " / " + formatPrice(result.ema20)
    );

    setText("signalRSI", result.rsi.toFixed(1));

    setText("bosChoch", result.structure);
    setText("fvgDetail", result.fvg);
    setText("obDetail", result.orderBlock);
    setText("liqDetail", result.liquidity);
    setText("pdDetail", result.premiumDiscount);
    setText("atrDetail", formatPrice(result.atr));

    const modeDescriptions = {
        scalping: "Scalping study: fokus kepada pergerakan timeframe rendah. Bacaan ini tidak menjamin entry yang tepat.",
        intraday: "Intraday study: ringkasan momentum dan struktur harga dalam sesi harian.",
        swing: "Swing study: gunakan timeframe lebih besar untuk melihat konteks trend."
    };

    setText("modeDescription", modeDescriptions[currentMode]);

    renderLevels(result);
    saveHistory(result);
}


/* =========================================================
   11 | MAIN MARKET REFRESH
========================================================= */

async function refreshMarket(options = {}) {
    if (requestBusy) return;

    const force = options.force === true;

    const elapsed = Date.now() - lastRequestTime;

    if (!force && elapsed < REQUEST_GAP) {
        return;
    }

    requestBusy = true;
    lastRequestTime = Date.now();

    setStatus("FETCHING…", COLORS.gold);

    try {
        const values = await fetchMarketData(currentTF);
        const candles = normalizeCandles(values);

        if (candles.length < 30) {
            throw new Error("Data candle tidak mencukupi.");
        }

        latestCandles = candles;

        if (!chart) initChart();

        if (candleSeries) {
            candleSeries.setData(candles);
        }

        const result = analyzeMarket(candles);

        renderAnalysis(result);

        $("chartEmpty")?.classList.add("hidden");

        setStatus("CONNECTED", COLORS.green);

        if (chart) {
            updateZoneOverlay();
        }

    } catch (error) {
        console.error("ADLI MARKET ERROR:", error);

        setStatus("DATA ERROR", COLORS.red);

        const empty = $("chartEmpty");

        if (empty && !latestCandles.length) {
            empty.classList.remove("hidden");
            empty.textContent = error.message || "Data tidak tersedia.";
        }

    } finally {
        requestBusy = false;
    }
}


/* =========================================================
   12 | TIMEFRAME CONTROLS
========================================================= */

function setTimeframe(tf) {
    if (!TIMEFRAMES[tf]) return;

    currentTF = tf;

    document.querySelectorAll("[data-tf]").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.tf === tf
        );
    });

    setText("signalTF", TF_LABELS[tf]);

    refreshMarket({ force: true });
}


/* =========================================================
   13 | MULTI-TIMEFRAME STUDY
========================================================= */

async function refreshMTF() {
    if (mtfBusy) return;

    mtfBusy = true;

    setText("mtfUpdated", "UPDATING…");

    const frames = [
        "1m",
        "5m",
        "15m",
        "30m",
        "1h",
        "4h",
        "1d"
    ];

    const ids = {
        "1m": "mtf1m",
        "5m": "mtf5m",
        "15m": "mtf15m",
        "30m": "mtf30m",
        "1h": "mtf1h",
        "4h": "mtf4h",
        "1d": "mtf1d"
    };

    try {
        for (const tf of frames) {
            try {
                const values = await fetchMarketData(tf);
                const candles = normalizeCandles(values);

                if (candles.length < 30) {
                    setText(ids[tf], "INSUFFICIENT DATA");
                    continue;
                }

                const result = analyzeMarket(candles);

                mtfCache[tf] = result;

                const label =
                    result.signal === "BUY BIAS"
                        ? "▲ BULLISH"
                        : result.signal === "SELL BIAS"
                            ? "▼ BEARISH"
                            : "● NEUTRAL";

                setText(
                    ids[tf],
                    label + " · " + result.score + "%"
                );

                const element = $(ids[tf]);

                if (element) {
                    element.style.color =
                        result.signal === "BUY BIAS"
                            ? COLORS.green
                            : result.signal === "SELL BIAS"
                                ? COLORS.red
                                : COLORS.gold;
                }

            } catch (error) {
                console.warn("MTF error:", tf, error);
                setText(ids[tf], "DATA UNAVAILABLE");
            }

            await new Promise(resolve => setTimeout(resolve, 900));
        }

        setText("mtfUpdated", "UPDATED " + nowString());

    } finally {
        mtfBusy = false;
    }
}


/* =========================================================
   14 | MARKET SESSIONS · MALAYSIA TIME
========================================================= */

function updateSessions() {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kuala_Lumpur",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23"
    }).formatToParts(new Date());

    const hour = Number(
        parts.find(p => p.type === "hour")?.value || 0
    );

    const minute = Number(
        parts.find(p => p.type === "minute")?.value || 0
    );

    const total = hour * 60 + minute;

    function session(start, end) {
        return total >= start && total < end
            ? "● ACTIVE"
            : "○ CLOSED";
    }

    const asia = session(7 * 60, 16 * 60);
    const london = session(15 * 60, 24 * 60);
    const newYork = session(20 * 60, 29 * 60);

    setText("sessionAsia", asia);
    setText("sessionLondon", london);
    setText("sessionNewYork", newYork);

    setText("newsAsia", asia);
    setText("newsLondon", london);
    setText("newsNY", newYork);

    setText(
        "klTime",
        String(hour).padStart(2, "0") + ":" +
        String(minute).padStart(2, "0") + " MYT"
    );
}


/* =========================================================
   15 | CALENDAR PLACEHOLDER
========================================================= */

function initCalendar() {
    const today = new Date();

    setText(
        "calendarToday",
        today.toLocaleDateString("en-MY", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            timeZone: "Asia/Kuala_Lumpur"
        })
    );

    setText("calendarCount", "N/A");
    setText("calendarHigh", "N/A");
    setText("calendarUpdated", "NOT CONNECTED");

    setText(
        "calendarMessage",
        "Kalendar ekonomi belum disambungkan kepada sumber data. Tiada berita, forecast atau actual akan direka."
    );

    setText("newsStatus", "SOURCE NOT CONNECTED");

    document.querySelectorAll("[data-calendar-filter]").forEach(button => {
        button.addEventListener("click", () => {
            document.querySelectorAll("[data-calendar-filter]").forEach(b => {
                b.classList.remove("active");
            });

            button.classList.add("active");
        });
    });
}


/* =========================================================
   16 | MODE CONTROLS
========================================================= */

function setMode(mode) {
    if (!["scalping", "intraday", "swing"].includes(mode)) {
        return;
    }

    currentMode = mode;

    document.querySelectorAll("[data-mode]").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.mode === mode
        );
    });

    if (latestAnalysis) {
        renderAnalysis(latestAnalysis);
    }
}


/* =========================================================
   17 | LANGUAGE
========================================================= */

function setLanguage(language) {
    currentLanguage = language === "en" ? "en" : "ms";

    window.ADLI_LANG = currentLanguage;

    localStorage.setItem("adli_language", currentLanguage);

    const button = $("languageButton");

    if (button) {
        button.textContent = currentLanguage === "en" ? "BM" : "EN";
    }

    setText(
        "languageStatus",
        currentLanguage === "en" ? "English" : "Bahasa Melayu"
    );

    document.querySelectorAll(".nav-btn").forEach(nav => {
        const label = nav.dataset[currentLanguage];

        if (label) {
            const active = nav.classList.contains("active");

            nav.textContent = label;

            if (active) {
                setText(
                    "pageTitle",
                    label.replace(/^[◈⌁▣▤◉⚙]\s*/, "")
                );
            }
        }
    });
}


/* =========================================================
   18 | UI EVENT LISTENERS
========================================================= */

function bindEvents() {
    document.querySelectorAll("[data-tf]").forEach(button => {
        button.addEventListener("click", () => {
            setTimeframe(button.dataset.tf);
        });
    });

    document.querySelectorAll("[data-mode]").forEach(button => {
        button.addEventListener("click", () => {
            setMode(button.dataset.mode);
        });
    });

    $("refreshButton")?.addEventListener("click", () => {
        refreshMarket({ force: true });
    });

    $("mtfRefresh")?.addEventListener("click", refreshMTF);

    $("clearHistory")?.addEventListener("click", clearHistory);

    $("languageButton")?.addEventListener("click", () => {
        setLanguage(currentLanguage === "ms" ? "en" : "ms");
    });
}


/* =========================================================
   19 | INITIALIZATION
========================================================= */

function startRefreshTimer() {
    if (refreshTimer) {
        clearInterval(refreshTimer);
    }

    refreshTimer = setInterval(() => {
        refreshMarket();
    }, REFRESH_INTERVAL);
}

function initialize() {
    initChart();
    loadHistory();
    bindEvents();
    initCalendar();
    updateSessions();
    setLanguage(currentLanguage);

    refreshMarket({ force: true });

    startRefreshTimer();

    setInterval(updateSessions, 30000);
}


/* =========================================================
   20 | PUBLIC APP API
========================================================= */

window.ADLI_MARKET = {
    fetch: fetchMarketData,
    normalize: normalizeCandles,
    refresh: refreshMarket,
    getCandles: () => latestCandles,
    getPrice: () => latestPrice
};

window.ADLI_ANALYSIS = {
    analyze: analyzeMarket,
    ema: calculateEMA,
    rsi: calculateRSI,
    atr: calculateATR,
    levels: calculateLevels
};

window.ADLI_APP = {
    resizeChart,
    refresh: () => refreshMarket({ force: true }),
    refreshMTF,
    setLanguage,
    setTimeframe,
    setMode,

    get chart() {
        return chart;
    },

    get analysis() {
        return latestAnalysis;
    },

    get price() {
        return latestPrice;
    }
};


/* =========================================================
   21 | START
========================================================= */

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
} else {
    initialize();
}

})();
