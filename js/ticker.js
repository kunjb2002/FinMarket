// ─── ticker.js ────────────────────────────────────────────────────────────────
// Fetches live quotes for the ticker tape using Finnhub.
//
// WHY THIS WORKS NOW (vs Alpha Vantage):
//   Alpha Vantage free = 25 calls/DAY total.  9 tape symbols = 9 calls burned
//   just on load, leaving only 16 for chart data. After a couple reloads, you
//   hit the wall and get rate-limit JSON → no price data → tape shows % only.
//
//   Finnhub free = 60 calls/MINUTE, NO daily cap.  9 tape symbols = ~3 seconds
//   of fetch time at 300ms throttle — well within limits.
//   Quotes are cached for 1 hour so repeat visits use zero API calls.

import { fetchQuote } from "./api.js";
import { saveCache, getCache } from "./cache.js";
import { CACHE_DURATION_QUOTE } from "../config/config.js";

const TAPE_SYMBOLS = ["SPY","AAPL","TSLA","NVDA","META","MSFT","GOOGL","AMZN","QQQ"];
const cacheKey = sym => `fmkt_quote_${sym}`;

// ── Entry point ───────────────────────────────────────────────────────────────
export async function initTickerTape() {
    // 1. Instant render from cache (no flash of empty tape)
    TAPE_SYMBOLS.forEach(sym => {
        const cached = getCache(cacheKey(sym));
        if (cached) applyToTape(sym, cached);
    });

    // 2. Fetch fresh data in background, throttled to be safe
    for (const sym of TAPE_SYMBOLS) {
        if (getCache(cacheKey(sym))) continue; // still fresh — skip

        try {
            const quote = await fetchQuote(sym);
            saveCache(cacheKey(sym), quote, CACHE_DURATION_QUOTE);
            applyToTape(sym, quote);
        } catch (err) {
            console.warn(`Tape quote failed for ${sym}:`, err.message);
        }

        await sleep(300); // 300ms between requests → ~3 req/s, well under 60/min
    }
}

// ── Apply a quote to every matching tape element ──────────────────────────────
function applyToTape(symbol, quote) {
    // There are two copies of each item (for seamless scroll loop)
    document.querySelectorAll(`.tape-item[data-sym="${symbol}"]`).forEach(el => {
        const { price, changePct } = quote;
        const sign  = changePct >= 0 ? "+" : "";
        const isUp  = changePct >= 0;
        const pStr  = price >= 1000
            ? price.toFixed(0)
            : price >= 10
                ? price.toFixed(2)
                : price.toFixed(3);

        el.innerHTML = `${symbol} <b>${sign}${changePct.toFixed(2)}%</b> <span class="tape-price">$${pStr}</span>`;
        el.className = `tape-item ${isUp ? "up" : "down"}`;

        // Brief highlight flash when value updates
        el.classList.add("refreshed");
        setTimeout(() => el.classList.remove("refreshed"), 700);
    });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));