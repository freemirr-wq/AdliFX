/* =========================================================
 ADLI FX INTEL V5 PREMIUM ENGINE
 Responsive UI support | BM / EN | Twelve Data
 Educational rule-based technical analysis only.
========================================================= */
(function () {
"use strict";

const CONFIG = window.ADLI_CONFIG;
if (!CONFIG) {
  console.error("ADLI V5: config.js missing.");
  return;
}

const FUNCTION_URL =
  String(CONFIG.SUPABASE_URL || "").replace(/\/$/, "") +
  "/functions/v1/market-data";

const API_KEY = CONFIG.SUPABASE_KEY;
const SYMBOL = "XAU/USD";
const REFRESH_MS = 5 * 60 * 1000;
const REQUEST_GAP_MS = 8000;
const STORAGE_KEY = "adli_fx_analysis_history_v5";

const TF = {
  "1m": "1min",
  "5m": "5min",
  "15m": "15min",
  "30m": "30min",
  "1h": "1h",
  "4h": "4h",
  "1d": "1day"
};

const MTF_IDS = {
  "1m": "mtf1m",
  "5m": "mtf5m",
  "15m": "mtf15m",
  "30m": "mtf30m",
  "1h": "mtf1h",
  "4h": "mtf4h",
  "1d": "mtf1d"
};

const COLORS = {
  gold: "#d9b45b",
  green: "#00c087",
  red: "#f6465d",
  muted: "#8492a6"
};

let currentTF = "5m";
let mode = "scalping";
let candles = [];
let chart = null;
let series = null;
let resizeObserver = null;
let started = false;
let chartLoading = false;
let mtfLoading = false;
let lastRequestTime = 0;
let queue = Promise.resolve();
let mtfCache = {};
let lastError = null;
let priceLines = [];
let lastHistoryKey = "";
let lastResult = null;
let language = localStorage.getItem("adli_language") || "ms";
let calendarFilter = "today";

const $ = id => document.getElementById(id);
const fmt = n =>
  Number.isFinite(Number(n)) ? Number(n).toFixed(2) : "--";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function tx(id, value, color) {
  const el = $(id);
  if (!el) return;
  el.textContent = value;
  if (color) el.style.color = color;
}

function queued(task) {
  const p = queue.then(async () => {
    const wait = Math.max(
      0,
      REQUEST_GAP_MS - (Date.now() - lastRequestTime)
    );

    if (wait) await sleep(wait);

    lastRequestTime = Date.now();
    return task();
  });

  queue = p.catch(() => {});
  return p;
}

/* =========================================================
 LANGUAGE ENGINE
========================================================= */

const I18N = {
  ms: {
    logout: "LOG KELUAR",
    refresh: "MUAT SEMULA",
    overview: "Ringkasan",
    analysis: "Analisis Pasaran",
    news: "Kalendar Ekonomi",
    history: "Sejarah Bacaan",
    planner: "Kalkulator Matematik",
    settings: "Tetapan",
    mainMenu: "MENU UTAMA",
    system: "SISTEM",
    instrument: "INSTRUMEN",
    price: "HARGA DATA",
    trend: "ARAH PASARAN",
    dataStatus: "STATUS DATA",
    waiting: "MENUNGGU",
    chart: "CARTA EMAS · XAUUSD",
    refreshMtf: "KEMAS KINI MTF",
    technical: "BACAAN TEKNIKAL",
    strength: "Skor kekuatan",
    timeframe: "Timeframe",
    entry: "Entry rujukan",
    stopLoss: "Henti Rugi (SL)",
    tp1: "Ambil Untung 1",
    tp2: "Ambil Untung 2",
    tp3: "Ambil Untung 3",
    buyZone: "Zon BUY",
    sellZone: "Zon SELL",
    buyStatus: "Status BUY",
    sellStatus: "Status SELL",
    asia: "Asia",
    london: "London",
    newYork: "New York",
    malaysiaTime: "Waktu Malaysia",
    marketSessions: "SESI PASARAN · MYT",
    analysisMode: "MOD ANALISIS",
    scalping: "SCALPING",
    intraday: "INTRADAY",
    swing: "SWING",
    newsTitle: "KALENDAR EKONOMI & BERITA",
    calendarTitle: "KALENDAR EKONOMI · MYT",
    today: "Hari ini",
    tomorrow: "Esok",
    week: "Minggu ini",
    calendarNotConnected:
      "Sumber kalendar ekonomi belum disambungkan. Tiada acara atau angka berita akan direka.",
    sourceMissing: "SUMBER BELUM DISAMBUNG",
    noFeed: "TIADA FEED",
    connected: "BERSAMBUNG",
    updating: "SEDANG DIKEMAS KINI",
    noData: "TIADA DATA",
    hold: "TUNGGU",
    buy: "BELI",
    sell: "JUAL",
    premium: "PREMIUM",
    discount: "DISCOUNT",
    middle: "TENGAH JULAT",
    active: "AKTIF",
    outside: "DI LUAR WAKTU",
    educational:
      "Bacaan teknikal pendidikan sahaja. Bukan ramalan atau nasihat kewangan.",
    historyEmpty: "Belum ada rekod.",
    clearHistory: "PADAM SEJARAH",
    mathTitle: "KALKULATOR PERATUS MATEMATIK",
    calculate: "KIRA CONTOH",
    language: "Bahasa Melayu",
    loading: "Memuatkan data pasaran…",
    noCalendar: "Sumber kalendar belum disambungkan."
  },

  en: {
    logout: "LOG OUT",
    refresh: "REFRESH",
    overview: "Overview",
    analysis: "Market Analysis",
    news: "Economic Calendar",
    history: "Signal History",
    planner: "Math Calculator",
    settings: "Settings",
    mainMenu: "MAIN MENU",
    system: "SYSTEM",
    instrument: "INSTRUMENT",
    price: "MARKET PRICE",
    trend: "MARKET TREND",
    dataStatus: "DATA STATUS",
    waiting: "WAITING",
    chart: "GOLD CHART · XAUUSD",
    refreshMtf: "UPDATE MTF",
    technical: "TECHNICAL READING",
    strength: "Strength score",
    timeframe: "Timeframe",
    entry: "Reference entry",
    stopLoss: "Stop Loss (SL)",
    tp1: "Take Profit 1",
    tp2: "Take Profit 2",
    tp3: "Take Profit 3",
    buyZone: "BUY zone",
    sellZone: "SELL zone",
    buyStatus: "BUY status",
    sellStatus: "SELL status",
    asia: "Asia",
    london: "London",
    newYork: "New York",
    malaysiaTime: "Malaysia time",
    marketSessions: "MARKET SESSIONS · MYT",
    analysisMode: "ANALYSIS MODE",
    scalping: "SCALPING",
    intraday: "INTRADAY",
    swing: "SWING",
    newsTitle: "ECONOMIC CALENDAR & NEWS",
    calendarTitle: "ECONOMIC CALENDAR · MYT",
    today: "Today",
    tomorrow: "Tomorrow",
    week: "This week",
    calendarNotConnected:
      "Economic calendar source is not connected. No event or news figures will be fabricated.",
    sourceMissing: "SOURCE NOT CONNECTED",
    noFeed: "NO FEED",
    connected: "CONNECTED",
    updating: "UPDATING",
    noData: "NO DATA",
    hold: "HOLD",
    buy: "BUY",
    sell: "SELL",
    premium: "PREMIUM",
    discount: "DISCOUNT",
    middle: "MID-RANGE",
    active: "ACTIVE",
    outside: "OUTSIDE SESSION",
    educational:
      "Educational technical reading only. Not a prediction or financial advice.",
    historyEmpty: "No records yet.",
    clearHistory: "CLEAR HISTORY",
    mathTitle: "MATH PERCENTAGE CALCULATOR",
    calculate: "CALCULATE EXAMPLE",
    language: "English",
    loading: "Loading market data…",
    noCalendar: "Calendar source is not connected."
  }
};

function tr(key) {
  return I18N[language][key] || I18N.ms[key] || key;
}

function applyLanguage() {
  document.documentElement.lang = language === "en" ? "en" : "ms";
  window.ADLI_LANG = language;

  document.querySelectorAll(".nav-btn").forEach(button => {
    const key = button.dataset.page;
    const map = {
      overview: "overview",
      analysis: "analysis",
      news: "news",
      history: "history",
      planner: "planner",
      settings: "settings"
    };

    const icons = {
      overview: "◈",
      analysis: "⌁",
      news: "▣",
      history: "▤",
      planner: "◉",
      settings: "⚙"
    };

    button.textContent =
      icons[key] + " " + tr(map[key] || key);
  });

  const active = document.querySelector(".nav-btn.active");
  if (active) {
    const key = active.dataset.page;
    const map = {
      overview: "overview",
      analysis: "analysis",
      news: "news",
      history: "history",
      planner: "planner",
      settings: "settings"
    };
    tx("pageTitle", tr(map[key] || key));
  }

  tx("logoutButton", tr("logout"));
  tx("refreshButton", tr("refresh"));
  tx("mtfRefresh", tr("refreshMtf"));
  tx("languageStatus", tr("language"));

  document.querySelectorAll("[data-calendar-filter]").forEach(button => {
    button.textContent = tr(button.dataset.calendarFilter);
  });

  const languageButton = $("languageButton");
  if (languageButton) {
    languageButton.textContent = language === "ms" ? "EN" : "BM";
  }

  tx("calendarMessage", tr("calendarNotConnected"));
  tx("newsStatus", tr("sourceMissing"));

  renderHistory();
  if (candles.length) analyse();
}

function setupLanguage() {
  const button = $("languageButton");
  if (!button) return;

  button.addEventListener("click", () => {
    language = language === "ms" ? "en" : "ms";
    localStorage.setItem("adli_language", language);
    applyLanguage();
  });

  applyLanguage();
}

/* =========================================================
 MARKET DATA
========================================================= */

function emit() {
  window.dispatchEvent(
    new CustomEvent("adli:market-update", {
      detail: {
        status: Market.status,
        symbol: SYMBOL,
        price: Market.price,
        candles,
        timeframe: currentTF,
        updatedAt: Market.lastUpdated,
        error: Market.error
      }
    })
  );
}

function setStatus() {
  tx("goldPrice", Market.price == null ? "--" : fmt(Market.price));

  tx(
    "dataStatus",
    Market.status,
    Market.status === "CONNECTED"
      ? COLORS.green
      : Market.status === "ERROR"
      ? COLORS.red
      : COLORS.gold
  );

  const empty = $("chartEmpty");

  if (empty) {
    empty.style.display = candles.length ? "none" : "flex";
    if (!candles.length) {
      empty.textContent = Market.error || tr("loading");
    }
  }

  if (candles.length > 1) {
    const a = candles.at(-1).close;
    const b = candles.at(-2).close;

    tx(
      "marketTrend",
      a > b ? "BULLISH" : a < b ? "BEARISH" : "SIDEWAYS",
      a > b ? COLORS.green : a < b ? COLORS.red : COLORS.gold
    );
  }

  emit();
}

const Market = {
  status: "WAITING",
  price: null,
  lastUpdated: null,
  error: null,

  initChart() {
    const el = $("priceChart");
    if (!el || chart) return;

    if (!window.LightweightCharts) {
      this.status = "ERROR";
      this.error = "Chart library unavailable";
      setStatus();
      return;
    }

    try {
      chart = LightweightCharts.createChart(el, {
        width: Math.max(300, el.clientWidth),
        height: Math.max(250, el.clientHeight),
        layout: {
          background: { color: "#101827" },
          textColor: "#8492a6"
        },
        grid: {
          vertLines: { color: "#1c293a" },
          horzLines: { color: "#1c293a" }
        },
        rightPriceScale: { borderColor: "#263247" },
        timeScale: {
          borderColor: "#263247",
          timeVisible: true,
          secondsVisible: false
        },
        crosshair: { mode: 1 },
        localization: { priceFormatter: fmt }
      });

      series = chart.addCandlestickSeries({
        upColor: COLORS.green,
        downColor: COLORS.red,
        borderUpColor: COLORS.green,
        borderDownColor: COLORS.red,
        wickUpColor: COLORS.green,
        wickDownColor: COLORS.red,
        priceLineVisible: true
      });

      if (window.ResizeObserver) {
        resizeObserver = new ResizeObserver(() => this.resize());
        resizeObserver.observe(el);
      }

      window.addEventListener("resize", () => this.resize());

    } catch (e) {
      this.status = "ERROR";
      this.error = "Chart error: " + e.message;
      console.error(e);
      setStatus();
    }
  },

  convert(values) {
    if (!Array.isArray(values)) return [];

    return values.map(x => {
      const raw = String(x.datetime || "").trim();
      const v = raw.replace(" ", "T");
      const ms = Date.parse(
        /[zZ]|[+-]\d{2}:\d{2}$/.test(v) ? v : v + "Z"
      );

      return {
        time: Math.floor(ms / 1000),
        open: +x.open,
        high: +x.high,
        low: +x.low,
        close: +x.close
      };
    })
    .filter(x =>
      Number.isFinite(x.time) &&
      [x.open, x.high, x.low, x.close].every(Number.isFinite) &&
      x.high >= x.low
    )
    .sort((a, b) => a.time - b.time)
    .filter((x, i, a) => !i || x.time !== a[i - 1].time);
  },

  async request(tf) {
    if (!TF[tf]) throw Error("Invalid timeframe: " + tf);
    if (CONFIG.MARKET_DATA_ENABLED === false) {
      throw Error("Market data disabled in config.js");
    }
    if (!FUNCTION_URL || !API_KEY) {
      throw Error("Supabase configuration incomplete");
    }

    const q = new URLSearchParams({
      symbol: SYMBOL,
      interval: TF[tf]
    });

    const res = await fetch(
      FUNCTION_URL + "?" + q.toString(),
      {
        method: "GET",
        headers: { apikey: API_KEY }
      }
    );

    let data;

    try {
      data = await res.json();
    } catch (e) {
      throw Error("Invalid JSON response. HTTP " + res.status);
    }

    if (!res.ok) {
      throw Error(
        "HTTP " + res.status + ": " +
        (data.error || data.message || "Request failed")
      );
    }

    if (data.success !== true) {
      throw Error(data.error || data.message || "Provider error");
    }

    const out = this.convert(data.values);

    if (out.length < 30) {
      throw Error("Insufficient candle data: " + out.length);
    }

    return out;
  },

  async fetch(tf = currentTF) {
    if (chartLoading) return;

    chartLoading = true;
    this.status = candles.length ? "UPDATING" : "LOADING";
    this.error = null;
    setStatus();

    try {
      const received = await queued(() => this.request(tf));

      candles = received;
      currentTF = tf;
      this.price = candles.at(-1).close;
      this.lastUpdated = new Date();
      this.status = "CONNECTED";
      this.error = null;
      lastError = null;

      if (series && chart) {
        series.setData(candles);
        chart.timeScale().fitContent();
      }

      analyse();
      setStatus();

    } catch (e) {
      this.status = "ERROR";
      this.error = e.message;
      lastError = e.message;
      clearAnalysis("DATA ERROR · ANALYSIS PAUSED");
      console.error("ADLI MARKET ERROR", e);

    } finally {
      chartLoading = false;
      setStatus();
    }
  },

  setTimeframe(tf) {
    if (!TF[tf]) return;
    currentTF = tf;
    this.fetch(tf);
  },

  resize() {
    const el = $("priceChart");
    if (chart && el && el.clientWidth && el.clientHeight) {
      chart.applyOptions({
        width: el.clientWidth,
        height: el.clientHeight
      });
    }
  },

  getCandles() { return candles; },
  getPrice() { return this.price; },
  getStatus() { return this.status; }
};

/* =========================================================
 TECHNICAL ANALYSIS
========================================================= */

const Analysis = {
  ema(v, p) {
    if (!Array.isArray(v) || v.length < p) return null;

    const k = 2 / (p + 1);
    let e = v.slice(0, p).reduce((a, b) => a + b, 0) / p;

    for (let i = p; i < v.length; i++) {
      e = (v[i] - e) * k + e;
    }

    return e;
  },

  rsi(v, p = 14) {
    if (v.length <= p) return null;

    let g = 0, l = 0;

    for (let i = 1; i <= p; i++) {
      const d = v[i] - v[i - 1];
      if (d > 0) g += d;
      else l -= d;
    }

    g /= p;
    l /= p;

    for (let i = p + 1; i < v.length; i++) {
      const d = v[i] - v[i - 1];
      g = (g * (p - 1) + Math.max(d, 0)) / p;
      l = (l * (p - 1) + Math.max(-d, 0)) / p;
    }

    return l === 0
      ? (g === 0 ? 50 : 100)
      : 100 - 100 / (1 + g / l);
  },

  atr(d, p = 14) {
    if (d.length <= p) return null;

    const ranges = [];

    for (let i = 1; i < d.length; i++) {
      const c = d[i], b = d[i - 1];

      ranges.push(
        Math.max(
          c.high - c.low,
          Math.abs(c.high - b.close),
          Math.abs(c.low - b.close)
        )
      );
    }

    return ranges.slice(-p).reduce((a, b) => a + b, 0) / p;
  },

  analyse(d, selectedMode = mode) {
    if (!Array.isArray(d) || d.length < 50) {
      return {
        ready: false,
        signal: "HOLD",
        strength: 0,
        reason: "At least 50 candles are required"
      };
    }

    const c = d.map(x => x.close);
    const ema9 = this.ema(c, 9);
    const ema20 = this.ema(c, 20);
    const ema50 = this.ema(c, 50);
    const rsi = this.rsi(c);
    const atr = this.atr(d);

    if ([ema9, ema20, ema50, rsi, atr].some(
      x => x == null || !Number.isFinite(x)
    )) {
      return {
        ready: false,
        signal: "HOLD",
        strength: 0,
        reason: "Indicator calculation unavailable"
      };
    }

    let score = 0;

    if (ema9 > ema20) score += 2;
    else if (ema9 < ema20) score -= 2;

    if (c.at(-1) > ema20) score++;
    else if (c.at(-1) < ema20) score--;

    if (rsi > 54 && rsi < 72) score++;
    else if (rsi < 46 && rsi > 28) score--;

    if (ema20 > ema50) score++;
    else if (ema20 < ema50) score--;

    const threshold = selectedMode === "swing" ? 4 : 3;

    const signal =
      score >= threshold ? "BUY" :
      score <= -threshold ? "SELL" : "HOLD";

    return {
      ready: true,
      signal,
      strength: Math.min(100, Math.round(Math.abs(score) / 5 * 100)),
      score,
      ema9,
      ema20,
      ema50,
      rsi,
      atr,
      price: c.at(-1),
      data: d
    };
  },

  structure(d) {
    if (d.length < 12) return "INSUFFICIENT DATA";

    const x = d.slice(-12);
    const h1 = Math.max(...x.slice(0, 6).map(z => z.high));
    const h2 = Math.max(...x.slice(6).map(z => z.high));
    const l1 = Math.min(...x.slice(0, 6).map(z => z.low));
    const l2 = Math.min(...x.slice(6).map(z => z.low));

    if (h2 > h1 && l2 > l1) return "HIGHER HIGH / HIGHER LOW";
    if (h2 < h1 && l2 < l1) return "LOWER HIGH / LOWER LOW";

    return "RANGE / MIXED";
  },

  liquidity(d) {
    if (d.length < 12) return "INSUFFICIENT DATA";

    const last = d.at(-1);
    const prev = d.slice(-11, -1);
    const hi = Math.max(...prev.map(x => x.high));
    const lo = Math.min(...prev.map(x => x.low));

    if (last.high > hi && last.close < hi) return "REJECTION ABOVE";
    if (last.low < lo && last.close > lo) return "REJECTION BELOW";

    return "NO RECENT SWEEP";
  },

  fvg(d) {
    if (d.length < 3) return "INSUFFICIENT DATA";

    const a = d.at(-3);
    const c = d.at(-1);

    if (c.low > a.high) {
      return "BULLISH GAP · " + fmt(a.high) + " – " + fmt(c.low);
    }

    if (c.high < a.low) {
      return "BEARISH GAP · " + fmt(c.high) + " – " + fmt(a.low);
    }

    return "NO 3-CANDLE GAP";
  },

  orderBlock(d) {
    if (d.length < 5) return "INSUFFICIENT DATA";

    const a = d.at(-1);
    const b = d.at(-2);

    if (a.close > b.high) return "CLOSE ABOVE PREVIOUS HIGH";
    if (a.close < b.low) return "CLOSE BELOW PREVIOUS LOW";

    return "NO BREAK CONFIRMATION";
  },

  premiumDiscount(d) {
    const x = d.slice(-30);
    const hi = Math.max(...x.map(z => z.high));
    const lo = Math.min(...x.map(z => z.low));
    const mid = (hi + lo) / 2;
    const p = d.at(-1).close;

    return {
      label: p > mid ? "PREMIUM" : p < mid ? "DISCOUNT" : "MID-RANGE",
      high: hi,
      low: lo,
      mid
    };
  }
};

/* =========================================================
 CHART LEVELS
========================================================= */

function clearLines() {
  if (!series) return;

  priceLines.forEach(line => {
    try { series.removePriceLine(line); } catch (e) {}
  });

  priceLines = [];
}

function addLine(price, title, color) {
  if (!series || !Number.isFinite(price)) return;

  priceLines.push(
    series.createPriceLine({
      price,
      title,
      color,
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true
    })
  );
}

function clearAnalysis(reason) {
  tx("aiSignal", "HOLD", COLORS.gold);
  tx("signalStrength", reason || tr("waiting"), COLORS.gold);

  [
    "signalEMA", "signalRSI", "entry", "stopLoss",
    "tp1", "tp2", "tp3", "buyZone", "sellZone",
    "buyZoneStatus", "sellZoneStatus"
  ].forEach(id => tx(id, "--"));

  tx("signalTF", currentTF.toUpperCase());
  tx("signalUpdated", "PAUSED");

  const meter = $("signalMeterFill");
  if (meter) meter.style.width = "0%";

  clearLines();
  lastResult = null;
}

function zoneStatus(price, low, high, side) {
  if (price >= low && price <= high) return "TOUCHED";
  if (side === "BUY" && price < low) return "INVALIDATED";
  if (side === "SELL" && price > high) return "INVALIDATED";
  return "ACTIVE";
}

function renderLevels(r) {
  clearLines();

  const p = r.price;
  const a = r.atr;
  const up = r.signal === "BUY";

  const sl = up ? p - a * 1.5 : p + a * 1.5;
  const t1 = up ? p + a : p - a;
  const t2 = up ? p + a * 2 : p - a * 2;
  const t3 = up ? p + a * 3 : p - a * 3;

  const buyLow = p - a * .65;
  const buyHigh = p - a * .15;
  const sellLow = p + a * .15;
  const sellHigh = p + a * .65;

  const buyStatus = zoneStatus(p, buyLow, buyHigh, "BUY");
  const sellStatus = zoneStatus(p, sellLow, sellHigh, "SELL");

  tx("entry", fmt(p));
  tx("stopLoss", fmt(sl), COLORS.red);
  tx("tp1", fmt(t1), COLORS.green);
  tx("tp2", fmt(t2), COLORS.green);
  tx("tp3", fmt(t3), COLORS.green);

  tx("buyZone", fmt(buyLow) + " – " + fmt(buyHigh), COLORS.green);
  tx("buyZoneStatus", buyStatus,
    buyStatus === "INVALIDATED" ? COLORS.red :
    buyStatus === "TOUCHED" ? COLORS.gold : COLORS.green
  );

  tx("sellZone", fmt(sellLow) + " – " + fmt(sellHigh), COLORS.red);
  tx("sellZoneStatus", sellStatus,
    sellStatus === "INVALIDATED" ? COLORS.red :
    sellStatus === "TOUCHED" ? COLORS.gold : COLORS.green
  );

  addLine(p, "REFERENCE", COLORS.gold);
  addLine(sl, "SL STUDY", COLORS.red);
  addLine(t1, "TP1 STUDY", COLORS.green);
  addLine(t2, "TP2 STUDY", COLORS.green);
  addLine(t3, "TP3 STUDY", COLORS.green);
  addLine((buyLow + buyHigh) / 2, "BUY ZONE STUDY", COLORS.green);
  addLine((sellLow + sellHigh) / 2, "SELL ZONE STUDY", COLORS.red);
}

/* =========================================================
 HISTORY
========================================================= */

function historyRead() {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
}

function saveHistory(r) {
  const key = [
    currentTF,
    mode,
    r.signal,
    Math.round(r.price * 100),
    candles.at(-1).time
  ].join("|");

  if (key === lastHistoryKey) return;
  lastHistoryKey = key;

  const rows = historyRead();

  rows.unshift({
    time: new Date().toISOString(),
    mode,
    tf: currentTF,
    signal: r.signal,
    strength: r.strength,
    price: r.price
  });

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows.slice(0, 100)));
  } catch (e) {
    console.warn("History storage unavailable", e);
  }

  renderHistory();
}

function renderHistory() {
  const body = $("historyBody");
  if (!body) return;

  const rows = historyRead();

  if (!rows.length) {
    body.innerHTML =
      '<tr><td colspan="6" class="empty">' +
      tr("historyEmpty") +
      "</td></tr>";
    return;
  }

  body.innerHTML = rows.map(x => {
    const date = new Date(x.time).toLocaleString(
      language === "en" ? "en-GB" : "ms-MY"
    );

    return "<tr>" +
      "<td>" + date + "</td>" +
      "<td>" + String(x.mode).toUpperCase() + "</td>" +
      "<td>" + String(x.tf).toUpperCase() + "</td>" +
      "<td>" + String(x.signal) + "</td>" +
      "<td>" + Number(x.strength) + "%</td>" +
      "<td>" + fmt(Number(x.price)) + "</td>" +
      "</tr>";
  }).join("");
}

/* =========================================================
 ANALYSIS RENDER
========================================================= */

function analyse() {
  const r = Analysis.analyse(candles, mode);

  if (!r.ready) {
    clearAnalysis(r.reason);
    return;
  }

  lastResult = r;

  const color =
    r.signal === "BUY" ? COLORS.green :
    r.signal === "SELL" ? COLORS.red : COLORS.gold;

  tx("aiSignal", r.signal, color);
  tx("signalStrength", r.strength + "% score", color);

  tx(
    "signalEMA",
    r.ema9 > r.ema20 ? "EMA9 ABOVE EMA20" : "EMA9 BELOW EMA20",
    r.ema9 > r.ema20 ? COLORS.green : COLORS.red
  );

  tx("signalRSI", r.rsi.toFixed(2));
  tx("signalTF", currentTF.toUpperCase());
  tx("signalUpdated", new Date().toLocaleTimeString());

  const meter = $("signalMeterFill");

  if (meter) {
    meter.style.width = r.strength + "%";
    meter.style.background = color;
  }

  const structure = Analysis.structure(candles);
  const liquidity = Analysis.liquidity(candles);
  const fvg = Analysis.fvg(candles);
  const ob = Analysis.orderBlock(candles);
  const pd = Analysis.premiumDiscount(candles);

  tx("bosChoch", structure);
  tx("fvgDetail", fvg);
  tx("obDetail", ob);
  tx("liqDetail", liquidity);
  tx("pdDetail", pd.label + " · midpoint " + fmt(pd.mid));
  tx("atrDetail", fmt(r.atr));

  renderLevels(r);
  saveHistory(r);
}

/* =========================================================
 MULTI TIMEFRAME
========================================================= */

function updateMtf(tf, r, age) {
  const el = $(MTF_IDS[tf]);
  if (!el) return;

  if (!r || !r.ready) {
    el.textContent = tr("noData");
    el.style.color = COLORS.gold;
    return;
  }

  el.textContent =
    r.signal + " · " + r.strength + "%" + (age ? " · " + age : "");

  el.style.color =
    r.signal === "BUY" ? COLORS.green :
    r.signal === "SELL" ? COLORS.red : COLORS.gold;
}

async function refreshMTF() {
  if (mtfLoading) return;

  mtfLoading = true;
  tx("mtfUpdated", "LOADING 7 TIMEFRAMES", COLORS.gold);

  let ok = 0;

  try {
    for (const tf of Object.keys(TF)) {
      try {
        const d = await queued(() => Market.request(tf));
        const r = Analysis.analyse(d, mode);

        mtfCache[tf] = {
          result: r,
          updatedAt: Date.now()
        };

        updateMtf(tf, r);
        ok++;

      } catch (e) {
        const cached = mtfCache[tf];

        updateMtf(
          tf,
          cached && cached.result,
          cached
            ? Math.round((Date.now() - cached.updatedAt) / 60000) + "m old"
            : ""
        );

        console.warn("MTF " + tf, e.message);
      }
    }

    tx(
      "mtfUpdated",
      ok + "/7 UPDATED · " + new Date().toLocaleTimeString()
    );

  } finally {
    mtfLoading = false;
  }
}

/* =========================================================
 MODE
========================================================= */

function modeDescription() {
  const descriptions = {
    ms: {
      scalping:
        "Mod scalping: bacaan jangka pendek berdasarkan trend dan momentum. Untuk pembelajaran carta sahaja.",
      intraday:
        "Mod intraday: memberi penekanan kepada penjajaran trend dan momentum sesi.",
      swing:
        "Mod swing: memerlukan penjajaran trend yang lebih ketat. H1/H4 sesuai untuk kajian timeframe lebih luas."
    },
    en: {
      scalping:
        "Scalping mode: short-term trend and momentum study. Educational chart analysis only.",
      intraday:
        "Intraday mode: focuses on trend alignment and session momentum.",
      swing:
        "Swing mode: requires stronger trend alignment. H1/H4 are useful for broader timeframe study."
    }
  };

  tx("modeDescription", descriptions[language][mode]);
}

/* =========================================================
 MARKET SESSIONS
========================================================= */

function between(h, s, e) {
  return s < e ? h >= s && h < e : h >= s || h < e;
}

function updateSessions() {
  const now = new Date();

  const parts = (zone, opts) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      ...opts
    }).format(now);

  const kl = parts("Asia/Kuala_Lumpur", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });

  const kh = Number(parts("Asia/Kuala_Lumpur", {
    hour: "2-digit",
    hourCycle: "h23"
  }));

  const lh = Number(parts("Europe/London", {
    hour: "2-digit",
    hourCycle: "h23"
  }));

  const nh = Number(parts("America/New_York", {
    hour: "2-digit",
    hourCycle: "h23"
  }));

  const asia = between(kh, 8, 17);
  const london = between(lh, 8, 17);
  const ny = between(nh, 8, 17);

  const activeText = language === "en" ? "ACTIVE" : "AKTIF";
  const outsideText = tr("outside");

  tx("klTime", kl + " MYT");

  [
    ["sessionAsia", asia],
    ["newsAsia", asia],
    ["sessionLondon", london],
    ["newsLondon", london],
    ["sessionNewYork", ny],
    ["newsNY", ny]
  ].forEach(([id, on]) => {
    tx(
      id,
      on ? activeText : outsideText,
      on ? COLORS.green : COLORS.muted
    );
  });
}

/* =========================================================
 ECONOMIC CALENDAR
 No fabricated data. Provider not connected.
========================================================= */

function setupCalendar() {
  const date = new Intl.DateTimeFormat(
    language === "en" ? "en-US" : "ms-MY",
    {
      timeZone: "Asia/Kuala_Lumpur",
      day: "2-digit",
      month: "short",
      year: "numeric"
    }
  ).format(new Date());

  tx("calendarToday", date);
  tx("calendarCount", "--");
  tx("calendarHigh", "--");
  tx("calendarUpdated", "--");
  tx("newsStatus", tr("sourceMissing"));
  tx("calendarMessage", tr("calendarNotConnected"));

  const body = $("calendarBody");

  if (body) {
    body.innerHTML =
      '<tr><td colspan="8" class="empty">' +
      tr("noCalendar") +
      "</td></tr>";
  }

  document.querySelectorAll("[data-calendar-filter]").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-calendar-filter]").forEach(x => {
        x.classList.toggle("active", x === button);
      });

      calendarFilter = button.dataset.calendarFilter;
      tx("calendarMessage", tr("calendarNotConnected"));
    });
  });
}

/* =========================================================
 CONTROLS
========================================================= */

function setupControls() {
  document.querySelectorAll("[data-tf]").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-tf]").forEach(x => {
        x.classList.toggle("active", x === button);
      });

      Market.setTimeframe(button.dataset.tf);
    });
  });

  document.querySelectorAll("[data-mode]").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-mode]").forEach(x => {
        x.classList.toggle("active", x === button);
      });

      mode = button.dataset.mode;
      modeDescription();

      if (candles.length) analyse();
    });
  });

  $("refreshButton")?.addEventListener("click", () => {
    Market.fetch(currentTF);
  });

  $("mtfRefresh")?.addEventListener("click", refreshMTF);

  $("clearHistory")?.addEventListener("click", () => {
    const promptText = language === "en"
      ? "Clear local reading history?"
      : "Padam sejarah bacaan pada peranti ini?";

    if (confirm(promptText)) {
      localStorage.removeItem(STORAGE_KEY);
      lastHistoryKey = "";
      renderHistory();
    }
  });
}

/* =========================================================
 CALCULATOR
========================================================= */

function setupCalculator() {
  $("calculateRisk")?.addEventListener("click", () => {
    const amount = Number($("balance").value);
    const percent = Number($("risk").value);
    const output = $("riskResult");

    if (
      !Number.isFinite(amount) ||
      !Number.isFinite(percent) ||
      amount <= 0 ||
      percent < 0 ||
      percent > 100
    ) {
      output.textContent = language === "en"
        ? "Enter valid values. Percentage must be between 0 and 100."
        : "Masukkan nilai sah. Peratus mestilah antara 0 hingga 100.";
      return;
    }

    const result = (amount * percent / 100).toFixed(2);

    output.textContent = language === "en"
      ? "Example value: " + result
      : "Nilai contoh: " + result;
  });
}

/* =========================================================
 INITIALIZATION
========================================================= */

function start() {
  if (started) return;
  started = true;

  Market.initChart();
  setupControls();
  setupLanguage();
  setupCalendar();
  setupCalculator();
  modeDescription();
  renderHistory();
  updateSessions();

  setInterval(updateSessions, 30000);

  Market.fetch(currentTF);
  setInterval(() => Market.fetch(currentTF), REFRESH_MS);

  console.log("ADLI FX INTEL V5 PREMIUM READY");
}

window.ADLI_MARKET = Market;
window.ADLI_ANALYSIS = Analysis;

window.ADLI_APP = {
  resizeChart: () => Market.resize(),
  refresh: () => Market.fetch(currentTF),
  refreshMTF,
  getTimeframe: () => currentTF,
  getMode: () => mode,
  getCandles: () => Market.getCandles(),
  getPrice: () => Market.getPrice(),
  getStatus: () => Market.getStatus(),
  getError: () => lastError,
  getMtfCache: () => mtfCache,
  getLanguage: () => language,
  setLanguage: value => {
    if (value !== "ms" && value !== "en") return;
    language = value;
    localStorage.setItem("adli_language", language);
    applyLanguage();
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", start, { once: true });
} else {
  start();
}

})();
