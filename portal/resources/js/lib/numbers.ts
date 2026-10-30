/** Number formatting shared by charts and pages (kept apart from the chart library so it stays tiny). */

/** 1 234 567 -> "1.23M", for axis labels and big readouts. */
export function compact(value: number, digits = 1): string {
    const abs = Math.abs(value);
    if (abs >= 1e9) return `${(value / 1e9).toFixed(digits)}B`;
    if (abs >= 1e6) return `${(value / 1e6).toFixed(digits)}M`;
    if (abs >= 1e3) return `${(value / 1e3).toFixed(digits)}K`;
    return `${Math.round(value)}`;
}

export function money(value: number, currency: string, digits = 1): string {
    return `${currency} ${compact(value, digits)}`;
}
