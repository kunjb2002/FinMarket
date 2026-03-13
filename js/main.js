// ─── main.js ──────────────────────────────────────────────────────────────────
import { fetchCandles, generateFallbackCandles } from "./api.js";
import { saveCache, getCache, clearCache }       from "./cache.js";
import { renderChart }                           from "./chart.js";
import { calculateEMA, calculateRSI }            from "./indicators.js";
import { initTickerTape }                        from "./ticker.js";
import {
    DEFAULT_SYMBOL,
    DEFAULT_TIMEFRAME,
    CACHE_DURATION_CANDLE,
} from "../config/config.js";

// ── State ─────────────────────────────────────────────────────────────────────
let allCandles      = [];
let filteredCandles = [];

let showPrice  = true;
let showEMA    = true;
let showRSI    = false;
let showVolume = true;
let currentTF  = "1M";

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    // Clear any old proxy-based cache entries that would have bad data
    clearCache("fmkt_candle_");
    bindUI();
    loadStock(DEFAULT_SYMBOL);
    initTickerTape();
});

// ── UI bindings ───────────────────────────────────────────────────────────────
function bindUI() {
    document.getElementById("searchBtn").addEventListener("click", () => {
        const sym = document.getElementById("tickerInput").value.trim().toUpperCase();
        if (sym) loadStock(sym);
    });

    document.getElementById("tickerInput").addEventListener("keypress", e => {
        if (e.key === "Enter") {
            const sym = e.target.value.trim().toUpperCase();
            if (sym) loadStock(sym);
        }
    });

    document.querySelectorAll(".timeframe-controls button").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".timeframe-controls button")
                .forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentTF = btn.dataset.time;
            applyTimeframe();
            updateChart();
        });
    });

    document.getElementById("btnPrice")?.addEventListener("click", function () {
        showPrice = !showPrice;
        this.classList.toggle("active", showPrice);
        updateChart();
    });
    document.getElementById("btnEMA")?.addEventListener("click", function () {
        showEMA = !showEMA;
        this.classList.toggle("active", showEMA);
        updateChart();
    });
    document.getElementById("btnRSI")?.addEventListener("click", function () {
        showRSI = !showRSI;
        this.classList.toggle("active", showRSI);
        document.querySelector(".rsi-panel").style.display  = showRSI ? "block" : "none";
        document.getElementById("rsiDivider").style.display = showRSI ? "flex"  : "none";
        updateChart();
    });
    document.getElementById("btnVolume")?.addEventListener("click", function () {
        showVolume = !showVolume;
        this.classList.toggle("active", showVolume);
        updateChart();
    });

    document.querySelectorAll(".qp-btn, .tape-item").forEach(el => {
        el.addEventListener("click", () => {
            const sym = el.dataset.sym;
            if (sym) loadStock(sym);
        });
    });
}

// ── Load a stock ──────────────────────────────────────────────────────────────
export async function loadStock(symbol) {
    showLoading(true);
    clearError();
    showDemoNotice(false);
    document.getElementById("tickerTitle").textContent = symbol;
    document.getElementById("tickerInput").value = symbol;

    const cacheKey = `fmkt_candle_${symbol}`;
    let candles = getCache(cacheKey);

    if (candles) {
        // Restore Date objects after JSON round-trip
        candles = candles.map(c => ({ ...c, x: new Date(c.x) }));
    } else {
        try {
            candles = await fetchCandles(symbol);
            // If API returned fallback (generated) data it won't have "5. volume" key
            // We detect that by checking if it came from generateFallbackCandles
            // which sets a _fallback flag — but simpler: if AV key is missing or rate
            // limited, fetchCandles() returns generated data without throwing.
            // Cache it for only 5 min so a real fetch is retried sooner.
            const isFallback = candles[0]?._fallback === true;
            saveCache(cacheKey, candles, isFallback ? 5 * 60 * 1000 : CACHE_DURATION_CANDLE);
        } catch (err) {
            // Should never reach here since fetchCandles() swallows errors
            // and returns fallback data — but just in case:
            console.error("loadStock unexpected error:", err);
            candles = generateFallbackCandles(symbol);
            showDemoNotice(true);
        }
    }

    // Detect if we ended up with generated data
    // (AV real data has .time as YYYY-MM-DD from object keys; generated also does)
    // We flag by checking volume scale: generated vol is always 2M-10M range
    // More reliably: re-expose _fallback on generateFallbackCandles
    if (!candles.length) {
        showError(`No data available for "${symbol}"`);
        showLoading(false);
        return;
    }

    allCandles = candles;
    applyTimeframe();
    updateChart();
    showLoading(false);
}

// ── Timeframe slice ───────────────────────────────────────────────────────────
function applyTimeframe() {
    // compact = last 100 trading days. Cap 1Y/ALL to whatever we actually have.
    const sliceMap = { "1D": 1, "1W": 5, "1M": 22, "3M": 65, "1Y": Infinity, "ALL": Infinity };
    const n = sliceMap[currentTF] ?? 252;
    filteredCandles = n === Infinity ? [...allCandles] : allCandles.slice(-n);
}

// ── Render ────────────────────────────────────────────────────────────────────
function updateChart() {
    if (!filteredCandles.length) return;
    const prices = filteredCandles.map(c => c.close ?? c.c);
    const ema    = showEMA ? calculateEMA(prices, 20) : null;
    const rsi    = showRSI ? calculateRSI(prices, 14) : null;
    renderChart(filteredCandles, ema, rsi, showVolume);
}

// ── UI helpers ────────────────────────────────────────────────────────────────
function showLoading(on) {
    const el = document.getElementById("loadingSpinner");
    if (el) el.style.display = on ? "flex" : "none";
}
function showError(msg) {
    const el = document.getElementById("errorMsg");
    if (el) { el.textContent = msg; el.style.display = "block"; }
}
function clearError() {
    const el = document.getElementById("errorMsg");
    if (el) el.style.display = "none";
}
function showDemoNotice(on) {
    let el = document.getElementById("demoNotice");
    if (!el && on) {
        // Create it once
        el = document.createElement("div");
        el.id = "demoNotice";
        el.style.cssText = `
            background: rgba(250,204,21,0.08);
            border: 1px solid rgba(250,204,21,0.25);
            border-radius: 8px;
            padding: 8px 14px;
            font-size: 12px;
            color: #facc15;
            margin-bottom: 10px;
        `;
        el.textContent = "⚠️ API rate limit reached — showing simulated chart data. Real data will load after the limit resets.";
        document.querySelector(".chart-wrapper")?.prepend(el);
    }
    if (el) el.style.display = on ? "block" : "none";
}