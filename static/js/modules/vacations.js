export function normalizeQuarterHours(hours) {
    const safe = Number.isFinite(hours) ? Math.max(0, hours) : 0;
    return Math.round(safe * 4) / 4;
}
