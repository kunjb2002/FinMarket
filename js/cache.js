// ─── cache.js ─────────────────────────────────────────────────────────────────

export function saveCache(key, data, ttl) {
    try {
        localStorage.setItem(key, JSON.stringify({ ts: Date.now(), ttl, data }));
    } catch (e) {
        console.warn("Cache write failed:", e.message);
    }
}

export function getCache(key) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const item = JSON.parse(raw);
        if (Date.now() - item.ts > item.ttl) {
            localStorage.removeItem(key);
            return null;
        }
        return item.data;
    } catch {
        return null;
    }
}

// Clears all localStorage entries whose key starts with `prefix`
// Called on boot to purge stale/corrupt entries from old proxy-based fetches
export function clearCache(prefix = "fmkt_") {
    try {
        Object.keys(localStorage)
            .filter(k => k.startsWith(prefix))
            .forEach(k => localStorage.removeItem(k));
    } catch (e) {
        console.warn("Cache clear failed:", e.message);
    }
}