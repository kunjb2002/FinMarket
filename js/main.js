// ─── main.js ──────────────────────────────────────────────────────────────────
import { fetchCandles, fetchIntraday, generateFallbackCandles,
         generateFallbackIntraday, searchSymbols }  from "./api.js";
import { saveCache, getCache, clearCache }           from "./cache.js";
import { renderChart }                               from "./chart.js";
import { calculateEMA, calculateRSI }                from "./indicators.js";
import { initTickerTape }                            from "./ticker.js";
import { renderNews }                                from "./news.js";
import {
    DEFAULT_SYMBOL,
    CACHE_DURATION_CANDLE,
    CACHE_DURATION_INTRADAY,
} from "../config/config.js";

// ── State ─────────────────────────────────────────────────────────────────────
let dailyCandles    = [];   // full 100-day daily set for this symbol
let intradayCandles = [];   // today's 60min bars
let filteredCandles = [];   // what actually gets rendered

let currentSymbol = DEFAULT_SYMBOL;
let currentTF     = "1M";

let showEMA    = true;
let showRSI    = false;
let showVolume = true;

// ── Boot ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    bindUI();
    bindAutocomplete();
    loadStock(DEFAULT_SYMBOL);
    initTickerTape();
});

// ── UI bindings ───────────────────────────────────────────────────────────────
function bindUI() {
    // Search button
    document.getElementById("searchBtn").addEventListener("click", () => {
        const sym = document.getElementById("tickerInput").value.trim().toUpperCase();
        if (sym) { closeDropdown(); loadStock(sym); }
    });

    // Enter key in search input
    document.getElementById("tickerInput").addEventListener("keydown", e => {
        if (e.key === "Enter") {
            const sym = e.target.value.trim().toUpperCase();
            if (sym) { closeDropdown(); loadStock(sym); }
        }
    });

    // Timeframe buttons
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

    // Indicator toggles
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

    // Quick-picks + tape items
    document.querySelectorAll(".qp-btn, .tape-item").forEach(el => {
        el.addEventListener("click", () => {
            const sym = el.dataset.sym;
            if (sym) loadStock(sym);
        });
    });
}

// ── Autocomplete ──────────────────────────────────────────────────────────────
let debounceTimer = null;

function bindAutocomplete() {
    const input    = document.getElementById("tickerInput");
    const dropdown = document.getElementById("autocompleteDropdown");
    if (!input || !dropdown) return;

    // Debounce: wait 350ms after last keystroke before calling API
    input.addEventListener("input", () => {
        clearTimeout(debounceTimer);
        const q = input.value.trim();

        if (q.length < 1) { closeDropdown(); return; }

        debounceTimer = setTimeout(async () => {
            const results = await searchSymbols(q);
            renderDropdown(results);
        }, 350);
    });

    // Keyboard nav: Escape closes, arrow keys move focus
    input.addEventListener("keydown", e => {
        if (e.key === "Escape") closeDropdown();
        if (e.key === "ArrowDown") {
            e.preventDefault();
            const first = dropdown.querySelector(".ac-item");
            first?.focus();
        }
    });

    // Close when clicking outside
    document.addEventListener("click", e => {
        if (!e.target.closest(".search-inner")) closeDropdown();
    });
}

function renderDropdown(results) {
    const dropdown = document.getElementById("autocompleteDropdown");
    if (!dropdown) return;

    if (!results.length) { closeDropdown(); return; }

    dropdown.innerHTML = results.map((r, i) => `
        <div class="ac-item" tabindex="0" data-sym="${r.symbol}" data-i="${i}">
            <div class="ac-left">
                <span class="ac-symbol">${r.symbol}</span>
                <span class="ac-type ${r.type === "ETF" ? "ac-etf" : "ac-stock"}">${r.type}</span>
            </div>
            <span class="ac-name">${r.name}</span>
        </div>
    `).join("");

    // Bind clicks and keyboard on each row
    dropdown.querySelectorAll(".ac-item").forEach(item => {
        item.addEventListener("click", () => selectSuggestion(item.dataset.sym));
        item.addEventListener("keydown", e => {
            if (e.key === "Enter")     selectSuggestion(item.dataset.sym);
            if (e.key === "Escape")    closeDropdown();
            if (e.key === "ArrowDown") item.nextElementSibling?.focus();
            if (e.key === "ArrowUp") {
                e.preventDefault();
                const prev = item.previousElementSibling;
                prev ? prev.focus() : document.getElementById("tickerInput")?.focus();
            }
        });
    });

    dropdown.style.display = "block";
}

function selectSuggestion(symbol) {
    document.getElementById("tickerInput").value = symbol;
    closeDropdown();
    loadStock(symbol);
}

function closeDropdown() {
    const dd = document.getElementById("autocompleteDropdown");
    if (dd) { dd.style.display = "none"; dd.innerHTML = ""; }
}

// ── Load a stock ──────────────────────────────────────────────────────────────
export async function loadStock(symbol) {
    currentSymbol = symbol;
    showLoading(true);
    clearError();
    showDemoNotice(false);
    document.getElementById("tickerTitle").textContent = symbol;
    document.getElementById("tickerInput").value = symbol;

    // Load both daily and intraday in parallel
    const [daily, intraday] = await Promise.all([
        loadDaily(symbol),
        loadIntraday(symbol),
    ]);

    dailyCandles    = daily;
    intradayCandles = intraday;

    applyTimeframe();
    updateChart();
    showLoading(false);

    // Fetch and render news for this symbol (non-blocking)
    renderNews(symbol);
}

async function loadDaily(symbol) {
    const key = `fmkt_candle_${symbol}`;
    let candles = getCache(key);
    if (candles) {
        const isCachedFallback = candles[0]?._fallback === true;
        showDemoNotice(isCachedFallback);
        return candles.map(c => ({ ...c, x: new Date(c.x) }));
    }

    candles = await fetchCandles(symbol);
    const isFallback = candles[0]?._fallback === true;

    // Cache real data for 24h; fallback for only 5 min so we retry real API soon
    saveCache(key, candles, isFallback ? 5 * 60 * 1000 : CACHE_DURATION_CANDLE);
    showDemoNotice(isFallback);
    return candles;
}

async function loadIntraday(symbol) {
    const key = `fmkt_intra_${symbol}`;
    let candles = getCache(key);
    if (candles) return candles.map(c => ({ ...c, x: new Date(c.x) }));

    candles = await fetchIntraday(symbol);
    saveCache(key, candles, CACHE_DURATION_INTRADAY);
    return candles;
}

// ── Timeframe → pick right dataset and slice ──────────────────────────────────
function applyTimeframe() {
    if (currentTF === "1D") {
        // 1D uses intraday 60min bars (today only)
        filteredCandles = intradayCandles.length ? [...intradayCandles] : dailyCandles.slice(-1);
        return;
    }
    const sliceMap = { "1W": 5, "1M": 22, "3M": 65, "1Y": Infinity, "ALL": Infinity };
    const n = sliceMap[currentTF] ?? Infinity;
    filteredCandles = n === Infinity ? [...dailyCandles] : dailyCandles.slice(-n);
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
        el = document.createElement("div");
        el.id = "demoNotice";
        el.style.cssText = `background:rgba(250,204,21,0.08);border:1px solid rgba(250,204,21,0.25);
            border-radius:8px;padding:8px 14px;font-size:12px;color:#facc15;margin-bottom:10px;`;
        el.textContent = "⚠️ API rate limit reached — showing simulated data. Resets in ~1 min.";
        document.querySelector(".chart-wrapper")?.prepend(el);
    }
    if (el) el.style.display = on ? "block" : "none";
}