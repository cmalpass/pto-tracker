export function normalizeQuarterHours(hours) {
    const numeric = Number(hours);
    const safe = Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
    return Math.round(safe * 4) / 4;
}
