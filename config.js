/* =====================================================
   ADLI FX INTEL INDICATOR
   CONFIGURATION V1.0
===================================================== */

window.ADLI_CONFIG = {

    // APPLICATION
    APP_NAME: "ADLI FX INTEL INDICATOR",
    APP_SHORT_NAME: "ADLI FX",
    APP_VERSION: "1.0.0",

    // MARKET
    DEFAULT_SYMBOL: "XAUUSD",

    TIMEFRAMES: [
        "1m",
        "5m",
        "15m",
        "30m",
        "1h",
        "4h",
        "1d"
    ],

    // SUPABASE
    SUPABASE_URL: "https://rgdeexhlbszajcgfysnc.supabase.co",

    SUPABASE_KEY: "sb_publishable_HxM7ZqdewVaw4lJxMGnl7w_p8rks-1U",

    // MARKET DATA
    MARKET_PROVIDER: "TWELVE_DATA",
    MARKET_DATA_ENABLED: true,

    // DASHBOARD
    DASHBOARD: {
        DEFAULT_TIMEFRAME: "5m",
        SHOW_WATERMARK: true,
        SHOW_MTF: true,
        SHOW_SIGNALS: true,
        SHOW_TRADE_LEVELS: true
    },

    // ANALYSIS
    ANALYSIS: {
        CONFIRMED_CANDLE_ONLY: true,
        SIGNAL_COOLDOWN_BARS: 8,
        SHOW_BOS: true,
        SHOW_CHOCH: true,
        SHOW_FVG: true,
        SHOW_ORDER_BLOCK: true,
        SHOW_LIQUIDITY_SWEEP: true
    },

    // DESIGN
    THEME: {
        BACKGROUND: "#080c14",
        PANEL: "#101827",
        GOLD: "#d9b45b",
        GOLD_LIGHT: "#f0d28b",
        BUY: "#00c087",
        SELL: "#f6465d",
        TEXT: "#f3f5f8",
        MUTED: "#8492a6"
    },

    // SECURITY
    SECURITY: {
        REQUIRE_LOGIN: true,
        REQUIRE_ACTIVE_SUBSCRIPTION: true,
        ALLOW_PREVIEW_MODE: false
    }

};

Object.freeze(window.ADLI_CONFIG);
