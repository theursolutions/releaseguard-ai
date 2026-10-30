/**
 * Shared chart setup: only the ECharts parts we use are bundled, and every chart gets the same
 * command-center look (dark) or clean light look, plus accessible defaults.
 */
import { BarChart, FunnelChart, GaugeChart, HeatmapChart, LineChart, PieChart, RadarChart } from 'echarts/charts';
import { AriaComponent, GridComponent, LegendComponent, MarkLineComponent, PolarComponent, TooltipComponent, VisualMapComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
    BarChart, FunnelChart, GaugeChart, HeatmapChart, LineChart, PieChart, RadarChart,
    AriaComponent, GridComponent, LegendComponent, MarkLineComponent, PolarComponent, TooltipComponent, VisualMapComponent,
    CanvasRenderer,
]);

export { echarts };
export type ChartOption = echarts.EChartsCoreOption;

export const PALETTE = {
    cyan: '#22d3ee',
    sky: '#38bdf8',
    violet: '#a78bfa',
    indigo: '#818cf8',
    emerald: '#34d399',
    amber: '#fbbf24',
    rose: '#fb7185',
    slate: '#64748b',
};

export const SERIES_COLORS = [PALETTE.cyan, PALETTE.violet, PALETTE.emerald, PALETTE.amber, PALETTE.rose, PALETTE.sky, PALETTE.indigo];

export function isDark(): boolean {
    return document.documentElement.classList.contains('dark');
}

/** Base options merged into every chart: transparent background, readable axes, glassy tooltip. */
export function baseOption(): ChartOption {
    const dark = isDark();
    const text = dark ? '#94a3b8' : '#475569';
    return {
        backgroundColor: 'transparent',
        color: SERIES_COLORS,
        textStyle: { color: text, fontFamily: 'Instrument Sans, ui-sans-serif, system-ui, sans-serif' },
        aria: { enabled: true },
        animationDuration: 900,
        animationEasing: 'cubicOut',
        tooltip: {
            backgroundColor: dark ? 'rgba(8,13,28,0.92)' : 'rgba(255,255,255,0.96)',
            borderColor: dark ? 'rgba(34,211,238,0.35)' : 'rgba(37,99,235,0.25)',
            borderWidth: 1,
            textStyle: { color: dark ? '#e2e8f0' : '#0f172a', fontSize: 12 },
            extraCssText: `backdrop-filter: blur(8px); border-radius: 10px; box-shadow: 0 10px 30px -10px ${dark ? 'rgba(34,211,238,0.35)' : 'rgba(15,23,42,0.2)'};`,
        },
        grid: { left: 8, right: 12, top: 36, bottom: 8, containLabel: true },
    };
}

/** Legend styling; charts opt in, so small charts never get a legend over their data. */
export function legend(extra: Record<string, unknown> = {}) {
    return { textStyle: { color: isDark() ? '#94a3b8' : '#475569' }, icon: 'roundRect', itemWidth: 10, itemHeight: 10, ...extra };
}

function axisColors() {
    const dark = isDark();
    return { text: dark ? '#94a3b8' : '#475569', line: dark ? 'rgba(148,163,184,0.12)' : 'rgba(100,116,139,0.18)' };
}

/** Axis presets (ECharts has no global per-axis-type defaults in setOption). */
export function categoryAxis(data: string[], extra: Record<string, unknown> = {}) {
    const { text, line } = axisColors();
    return { type: 'category', data, axisLine: { lineStyle: { color: line } }, axisTick: { show: false }, axisLabel: { color: text }, splitLine: { show: false }, ...extra };
}

export function valueAxis(extra: Record<string, unknown> = {}) {
    const { text, line } = axisColors();
    return { type: 'value', axisLine: { show: false }, axisLabel: { color: text }, splitLine: { lineStyle: { color: line, type: 'dashed' } }, ...extra };
}

/** Vertical gradient fill for area/bar series. */
export function glow(color: string, from = 0.45, to = 0) {
    return new echarts.graphic.LinearGradient(0, 0, 0, 1, [
        { offset: 0, color: hexToRgba(color, from) },
        { offset: 1, color: hexToRgba(color, to) },
    ]);
}

export function hexToRgba(hex: string, alpha: number): string {
    const value = hex.replace('#', '');
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

export { compact, money } from './numbers';
