export function timeAgo(value: string | null | undefined): string {
    if (!value) return '';
    const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
    if (Number.isNaN(seconds)) return '';
    if (seconds < 60) return 'just now';
    const units: [number, string][] = [
        [60, 'minute'],
        [3600, 'hour'],
        [86400, 'day'],
        [604800, 'week'],
    ];
    let unit = units[0];
    for (const candidate of units) {
        if (seconds >= candidate[0]) unit = candidate;
    }
    const amount = Math.floor(seconds / unit[0]);
    return `${amount} ${unit[1]}${amount === 1 ? '' : 's'} ago`;
}

export function formatDateTime(value: string | null | undefined): string {
    if (!value) return '';
    return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
