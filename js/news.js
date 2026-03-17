// ─── news.js ──────────────────────────────────────────────────────────────────
// Fetches and renders the news feed for the currently loaded symbol.
// Uses Finnhub /company-news — free tier, last 7 days, up to 6 articles.
// Cached for 1 hour per symbol.

import { fetchNews }      from "./api.js";
import { saveCache, getCache } from "./cache.js";

const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// ── renderNews(symbol) ────────────────────────────────────────────────────────
// Called by main.js every time a new stock loads.
export async function renderNews(symbol) {
    const section = document.getElementById("newsSection");
    const grid    = document.getElementById("newsGrid");
    const title   = document.getElementById("newsTitle");
    if (!section || !grid || !title) return;

    // Show skeleton while loading
    title.textContent = `${symbol} — Latest News`;
    showNewsSkeleton(grid);
    section.style.display = "block";

    // Cache check
    const key = `fmkt_news_${symbol}`;
    let articles = getCache(key);

    if (!articles) {
        articles = await fetchNews(symbol);
        if (articles.length) saveCache(key, articles, CACHE_TTL);
    }

    if (!articles.length) {
        grid.innerHTML = `
            <div class="news-empty">
                <span>📭</span>
                <p>No recent news found for <strong>${symbol}</strong>.</p>
                <p class="news-empty-sub">Try again later or check your Finnhub API key.</p>
            </div>`;
        return;
    }

    grid.innerHTML = articles.map(a => newsCard(a)).join("");
}

// ── newsCard — builds one article card ───────────────────────────────────────
function newsCard(a) {
    const ago     = timeAgo(a.time);
    const summary = a.summary
        ? a.summary.slice(0, 140) + (a.summary.length > 140 ? "…" : "")
        : "";

    const imgHtml = a.image
        ? `<div class="news-img" style="background-image:url('${a.image}')"></div>`
        : `<div class="news-img news-img-placeholder"><span>📰</span></div>`;

    return `
        <a class="news-card" href="${a.url}" target="_blank" rel="noopener noreferrer">
            ${imgHtml}
            <div class="news-body">
                <div class="news-meta">
                    <span class="news-source">${a.source}</span>
                    <span class="news-time">${ago}</span>
                </div>
                <h3 class="news-headline">${a.headline}</h3>
                ${summary ? `<p class="news-summary">${summary}</p>` : ""}
            </div>
        </a>`;
}

// ── skeleton placeholders while fetching ─────────────────────────────────────
function showNewsSkeleton(grid) {
    grid.innerHTML = Array(6).fill(`
        <div class="news-card news-skeleton">
            <div class="news-img skel-block"></div>
            <div class="news-body">
                <div class="skel-line skel-short"></div>
                <div class="skel-line skel-full"></div>
                <div class="skel-line skel-full"></div>
                <div class="skel-line skel-medium"></div>
            </div>
        </div>`).join("");
}

// ── timeAgo — "2h ago", "3d ago" ─────────────────────────────────────────────
function timeAgo(ms) {
    const diff = Date.now() - ms;
    const m = Math.floor(diff / 60000);
    if (m < 1)   return "just now";
    if (m < 60)  return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24)  return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
}