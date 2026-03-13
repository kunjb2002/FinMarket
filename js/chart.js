// ─── chart.js — powered by TradingView lightweight-charts ────────────────────
//
// WHY lightweight-charts:
//   chartjs-chart-financial has an unresolvable conflict with Chart.js's time
//   scale adapter — format() receives invalid values from the plugin regardless
//   of version pinning, causing RangeError: Invalid time value on every render.
//
//   lightweight-charts (TradingView open source):
//     • Accepts "YYYY-MM-DD" strings natively — zero date adapter needed
//     • No hitRadius / element API conflicts
//     • Purpose-built for OHLCV — candlestick, line, histogram built-in
//     • Syncs crosshair across price + RSI panes automatically
// ─────────────────────────────────────────────────────────────────────────────

// lightweight-charts is loaded as a global via the CDN script tag
const LWC = window.LightweightCharts;

// ── Chart instances (destroyed & recreated on each symbol load) ──────────────
let priceChartInstance = null;
let rsiChartInstance   = null;

// ── Series handles (kept so we can update data without recreating the chart) ─
let candleSeries  = null;
let emaSeries     = null;
let volumeSeries  = null;
let rsiLineSeries = null;

// ── Shared chart colours ──────────────────────────────────────────────────────
const THEME = {
    bg:           "#0b0f1e",
    grid:         "rgba(255,255,255,0.04)",
    border:       "#1e293b",
    textColor:    "#64748b",
    crosshair:    "#475569",
    upColor:      "#22c55e",
    downColor:    "#ef4444",
    emaColor:     "#facc15",
    rsiColor:     "#a78bfa",
    rsiOB:        "rgba(239,68,68,0.5)",
    rsiOS:        "rgba(34,197,94,0.5)",
    rsiMid:       "rgba(255,255,255,0.1)",
    volUp:        "rgba(34,197,94,0.18)",
    volDown:      "rgba(239,68,68,0.18)",
};

const CHART_OPTS = {
    layout: {
        background: { type: "solid", color: THEME.bg },
        textColor:  THEME.textColor,
        fontSize:   11,
    },
    grid: {
        vertLines: { color: THEME.grid },
        horzLines: { color: THEME.grid },
    },
    crosshair: {
        vertLine: { color: THEME.crosshair, labelBackgroundColor: THEME.border },
        horzLine: { color: THEME.crosshair, labelBackgroundColor: THEME.border },
    },
    timeScale: {
        borderColor:     THEME.border,
        timeVisible:     true,
        secondsVisible:  false,
    },
    rightPriceScale: { borderColor: THEME.border },
    handleScroll:    { vertTouchDrag: false },
};

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC: renderChart
// Called by main.js with the full normalised candle array + optional indicators
// ─────────────────────────────────────────────────────────────────────────────
export function renderChart(candles, ema = null, rsi = null, showVolume = true) {
    if (!LWC) { console.error("LightweightCharts not loaded"); return; }
    if (!candles?.length) return;

    destroyCharts();
    buildPriceChart(candles, ema, showVolume);
    buildRSIChart(candles, rsi);
    syncCrosshairs();
    updateKPIs(candles, ema, rsi);
}

// ─────────────────────────────────────────────────────────────────────────────
// PRICE CHART
// ─────────────────────────────────────────────────────────────────────────────
function buildPriceChart(candles, ema, showVolume) {
    const container = document.getElementById("priceChart");
    if (!container) return;

    // Make container fill its CSS-sized div
    container.style.position = "relative";

    priceChartInstance = LWC.createChart(container, {
        ...CHART_OPTS,
        width:  container.clientWidth,
        height: container.clientHeight,
        rightPriceScale: {
            ...CHART_OPTS.rightPriceScale,
            scaleMargins: { top: 0.05, bottom: showVolume ? 0.22 : 0.05 },
        },
    });

    // ── Candlestick series ────────────────────────────────────────────────────
    candleSeries = priceChartInstance.addCandlestickSeries({
        upColor:          THEME.upColor,
        downColor:        THEME.downColor,
        borderUpColor:    THEME.upColor,
        borderDownColor:  THEME.downColor,
        wickUpColor:      THEME.upColor,
        wickDownColor:    THEME.downColor,
    });

    // lightweight-charts needs {time: "YYYY-MM-DD", open, high, low, close}
    candleSeries.setData(candles.map(c => ({
        time:  c.time,
        open:  c.open  ?? c.o,
        high:  c.high  ?? c.h,
        low:   c.low   ?? c.l,
        close: c.close ?? c.c,
    })));

    // ── Volume histogram (secondary price scale) ──────────────────────────────
    if (showVolume) {
        volumeSeries = priceChartInstance.addHistogramSeries({
            priceFormat:    { type: "volume" },
            priceScaleId:   "volume",
            scaleMargins:   { top: 0.82, bottom: 0 },
        });
        priceChartInstance.priceScale("volume").applyOptions({
            scaleMargins: { top: 0.82, bottom: 0 },
        });
        volumeSeries.setData(candles.map(c => ({
            time:  c.time,
            value: c.volume ?? c.v ?? 0,
            color: (c.close ?? c.c) >= (c.open ?? c.o) ? THEME.volUp : THEME.volDown,
        })));
    }

    // ── EMA line ─────────────────────────────────────────────────────────────
    if (ema) {
        emaSeries = priceChartInstance.addLineSeries({
            color:              THEME.emaColor,
            lineWidth:          2,
            priceLineVisible:   false,
            lastValueVisible:   true,
            crosshairMarkerVisible: false,
        });
        // Map EMA values to candle times — skip nulls (first period-1 values)
        const emaData = candles
            .map((c, i) => ema[i] != null ? { time: c.time, value: +ema[i].toFixed(4) } : null)
            .filter(Boolean);
        emaSeries.setData(emaData);
    }

    // Fit the visible range to the data
    priceChartInstance.timeScale().fitContent();

    // Resize when the container size changes
    new ResizeObserver(() => {
        priceChartInstance?.applyOptions({
            width:  container.clientWidth,
            height: container.clientHeight,
        });
    }).observe(container);
}

// ─────────────────────────────────────────────────────────────────────────────
// RSI CHART
// ─────────────────────────────────────────────────────────────────────────────
function buildRSIChart(candles, rsi) {
    const container = document.getElementById("rsiChart");
    const divider   = document.getElementById("rsiDivider");
    if (!container) return;

    if (!rsi) {
        container.style.display = "none";
        if (divider) divider.style.display = "none";
        return;
    }

    container.style.display = "block";
    container.style.position = "relative";
    if (divider) divider.style.display = "flex";

    rsiChartInstance = LWC.createChart(container, {
        ...CHART_OPTS,
        width:  container.clientWidth,
        height: container.clientHeight,
        rightPriceScale: {
            ...CHART_OPTS.rightPriceScale,
            scaleMargins: { top: 0.1, bottom: 0.1 },
            autoScale: false,
            minValue: 0,
            maxValue: 100,
        },
        // Hide time axis on RSI — it's synced to price chart visually
        timeScale: { ...CHART_OPTS.timeScale, visible: false },
    });

    // RSI line
    rsiLineSeries = rsiChartInstance.addLineSeries({
        color:            THEME.rsiColor,
        lineWidth:        2,
        priceLineVisible: false,
        lastValueVisible: true,
        crosshairMarkerVisible: true,
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
    });

    const rsiData = candles
        .map((c, i) => rsi[i] != null ? { time: c.time, value: +rsi[i].toFixed(2) } : null)
        .filter(Boolean);

    rsiLineSeries.setData(rsiData);

    // Overbought / oversold / midline as price lines
    [
        { price: 70, color: THEME.rsiOB,  label: "OB" },
        { price: 50, color: THEME.rsiMid, label: ""   },
        { price: 30, color: THEME.rsiOS,  label: "OS" },
    ].forEach(({ price, color, label }) => {
        rsiLineSeries.createPriceLine({
            price, color, lineWidth: 1,
            lineStyle: LWC.LineStyle.Dashed,
            axisLabelVisible: !!label,
            title: label,
        });
    });

    rsiChartInstance.timeScale().fitContent();

    new ResizeObserver(() => {
        rsiChartInstance?.applyOptions({
            width:  container.clientWidth,
            height: container.clientHeight,
        });
    }).observe(container);
}

// ─────────────────────────────────────────────────────────────────────────────
// CROSSHAIR SYNC between price and RSI charts
// ─────────────────────────────────────────────────────────────────────────────
function syncCrosshairs() {
    if (!priceChartInstance || !rsiChartInstance) return;

    // Sync time scale scroll/zoom
    priceChartInstance.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (range) rsiChartInstance.timeScale().setVisibleLogicalRange(range);
    });
    rsiChartInstance.timeScale().subscribeVisibleLogicalRangeChange(range => {
        if (range) priceChartInstance.timeScale().setVisibleLogicalRange(range);
    });

    // Sync crosshair position
    priceChartInstance.subscribeCrosshairMove(param => {
        if (!param.point || !rsiLineSeries) return;
        const rsiPoint = param.seriesData.get(rsiLineSeries);
        if (rsiPoint) {
            rsiChartInstance.setCrosshairPosition(param.point.x, rsiPoint.value, rsiLineSeries);
            const el = document.getElementById("rsiValue");
            if (el) el.textContent = rsiPoint.value.toFixed(1);
        }

        // Update OHLCV tooltip in the divider
        if (candleSeries) {
            const bar = param.seriesData.get(candleSeries);
            if (bar) updateHoverTooltip(bar);
        }
    });

    rsiChartInstance.subscribeCrosshairMove(param => {
        if (!param.point || !candleSeries) return;
        priceChartInstance.setCrosshairPosition(param.point.x, 0, candleSeries);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// HOVER TOOLTIP  — updates an OHLCV row below the chart controls
// ─────────────────────────────────────────────────────────────────────────────
function updateHoverTooltip(bar) {
    // Inject once if not present
    let el = document.getElementById("ohlcTooltip");
    if (!el) {
        el = document.createElement("div");
        el.id = "ohlcTooltip";
        el.style.cssText = `
            display:flex; gap:16px; padding:6px 0 2px;
            font-family:'JetBrains Mono',monospace; font-size:11px;
        `;
        const controls = document.querySelector(".controls-row");
        controls?.insertAdjacentElement("afterend", el);
    }
    const fmt = v => `$${v.toFixed(2)}`;
    const isUp = bar.close >= bar.open;
    el.innerHTML = `
        <span style="color:#64748b">O</span><span style="color:#e2e8f0">${fmt(bar.open)}</span>
        <span style="color:#64748b">H</span><span style="color:#22c55e">${fmt(bar.high)}</span>
        <span style="color:#64748b">L</span><span style="color:#ef4444">${fmt(bar.low)}</span>
        <span style="color:#64748b">C</span><span style="color:${isUp ? "#22c55e" : "#ef4444"}">${fmt(bar.close)}</span>
    `;
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI CARDS
// ─────────────────────────────────────────────────────────────────────────────
function updateKPIs(candles, ema, rsi) {
    const last    = candles.at(-1);
    const prev    = candles.at(-2);
    const close   = last.close ?? last.c;
    const prevClose = prev ? (prev.close ?? prev.c) : close;
    const changePct = (close - prevClose) / prevClose * 100;
    const lastEma = ema ? ema.filter(v => v != null).at(-1) : null;
    const lastRsi = rsi ? rsi.filter(v => v != null).at(-1) : null;

    const set = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
    const col = (id, color) => { const el = document.getElementById(id); if (el) el.style.color = color; };

    set("kpiPrice",  `$${close.toFixed(2)}`);
    set("kpiChange", `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`);
    col("kpiChange", changePct >= 0 ? "#22c55e" : "#ef4444");

    set("kpiEMA", lastEma != null ? `$${lastEma.toFixed(2)}` : "--");

    if (lastRsi != null) {
        set("kpiRSI", lastRsi.toFixed(1));
        col("kpiRSI", lastRsi > 70 ? "#ef4444" : lastRsi < 30 ? "#22c55e" : "#facc15");
    } else {
        set("kpiRSI", "--");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// DESTROY — clean up before rendering a new symbol
// ─────────────────────────────────────────────────────────────────────────────
function destroyCharts() {
    if (priceChartInstance) { priceChartInstance.remove(); priceChartInstance = null; }
    if (rsiChartInstance)   { rsiChartInstance.remove();   rsiChartInstance   = null; }
    candleSeries = emaSeries = volumeSeries = rsiLineSeries = null;
}