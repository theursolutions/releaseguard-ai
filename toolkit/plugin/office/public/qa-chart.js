// devcrew QA: small time-series charts drawn by hand in SVG (no libraries), for load and stress tests.
// One measure per chart and one y-axis each. New points glide in (the y-scale eases, the newest segment
// grows); a crosshair with a tooltip follows the pointer or the arrow keys and is shared by every chart
// of a group. All text goes through textContent.
import { h, motionOK, svg } from './qa-ui.js';

const PAD = { top: 12, right: 14, bottom: 24, left: 46 };
const TWEEN_MS = 520;
const REVEAL_MS = 900;

export function formatClock(sec) {
  const total = Math.max(0, Math.round(sec));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** A tick step from 1, 2, 2.5 or 5 × 10ⁿ that splits 0..value into about four parts. */
function niceScale(value) {
  const max = value > 0 ? value : 1;
  const raw = max / 4;
  const exp = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * exp).find((candidate) => candidate >= raw) || 10 * exp;
  return { step, max: step * Math.max(1, Math.ceil(max / step - 1e-9)) };
}

function timeStep(domain, width) {
  const fit = Math.max(2, Math.floor(width / 64));
  return [1, 2, 5, 10, 15, 20, 30, 60, 120].find((step) => domain / step <= fit) || 120;
}

const ease = (t) => 1 - Math.pow(1 - t, 3);

/** Keeps the crosshair of several charts on the same second. */
export function createChartGroup() {
  const charts = new Set();
  return {
    add(chart) {
      charts.add(chart);
      chart.group = this;
    },
    focus(t, from) {
      for (const chart of charts) chart.showAt(t, chart === from);
    },
    clear() {
      for (const chart of charts) chart.showAt(null, false);
    },
  };
}

/**
 * options: title, series [{ key, label, tone }], type 'area' | 'lines' | 'step' | 'bars', format(value),
 * height, axisMax (a fixed top), cap (the highest top, e.g. 100 for percentages), minTop (the smallest top).
 */
export function createTimeChart(options) {
  const { title, series, type = 'lines', format = (value) => String(value), height = 180, minTop = 1 } = options;
  const legendValues = new Map();
  const legend = h(
    'ul',
    { class: 'chart-legend', 'aria-label': `${title}: latest values` },
    ...series.map((item) => {
      const value = h('span', { class: 'chart-legend-value', hidden: !options.live }, '–');
      legendValues.set(item.key, value);
      return h('li', { dataset: { tone: item.tone } }, h('span', { class: `chart-key chart-key-${type === 'bars' || series.length === 1 ? 'box' : 'line'}`, 'aria-hidden': 'true' }), h('span', { class: 'chart-legend-label' }, item.label), value);
    }),
  );
  const graphic = svg('svg', { class: 'chart-svg', 'aria-hidden': 'true', focusable: 'false' });
  const tooltip = h('div', { class: 'chart-tip', role: 'status', hidden: true });
  const plot = h('div', { class: 'chart-plot', tabindex: '0', role: 'group', 'aria-label': `${title} chart. Use the left and right arrow keys to read each second.` }, graphic, tooltip);
  const el = h('figure', { class: 'chart', dataset: { type } }, h('figcaption', { class: 'chart-head' }, h('span', { class: 'chart-title' }, title), legend), plot);

  const state = { points: [], domain: 10, limit: null, marker: null, width: 0, yTop: null, focusT: null, hovered: false };
  let anim = null;
  let shownLast = null;

  const value = (point, key) => (point && Number.isFinite(point[key]) ? point[key] : null);

  function targetTop() {
    if (options.axisMax) return options.axisMax;
    let max = minTop;
    for (const point of state.points) for (const item of series) max = Math.max(max, value(point, item.key) ?? 0);
    if (state.limit) max = Math.max(max, state.limit.value * 1.08);
    const top = niceScale(max * 1.04).max;
    return options.cap ? Math.min(options.cap, top) : top;
  }

  // ---------- drawing ----------

  function draw(points, top, reveal = 1) {
    const width = state.width;
    if (!width) return;
    graphic.setAttribute('viewBox', `0 0 ${width} ${height}`);
    graphic.setAttribute('width', String(width));
    graphic.setAttribute('height', String(height));
    const innerW = Math.max(10, width - PAD.left - PAD.right);
    const innerH = height - PAD.top - PAD.bottom;
    const domain = Math.max(state.domain, points.at(-1)?.t || 0, 1);
    const x = (t) => PAD.left + (t / domain) * innerW;
    const y = (v) => PAD.top + innerH - (Math.min(v, top) / top) * innerH;
    const children = [];

    // Grid: hairlines and clean tick labels, recessive.
    const { step } = niceScale(top);
    for (let tick = 0; tick <= top + 1e-9; tick += step) {
      const yy = Math.round(y(tick)) + 0.5;
      children.push(svg('line', { class: tick === 0 ? 'chart-base' : 'chart-grid', x1: PAD.left, x2: PAD.left + innerW, y1: yy, y2: yy }));
      const label = svg('text', { class: 'chart-tick', x: PAD.left - 8, y: yy + 4, 'text-anchor': 'end' });
      label.textContent = format(tick, true);
      children.push(label);
    }
    const tStep = timeStep(domain, innerW);
    for (let t = 0; t <= domain + 1e-9; t += tStep) {
      const label = svg('text', { class: 'chart-tick', x: x(t), y: height - 6, 'text-anchor': t === 0 ? 'start' : 'middle' });
      label.textContent = formatClock(t);
      children.push(label);
    }

    const clipId = `${el.dataset.uid}-clip`;
    const clip = svg('clipPath', { id: clipId });
    clip.append(svg('rect', { x: PAD.left - 6, y: 0, width: Math.max(0, (innerW + 12) * reveal), height }));
    children.push(clip);
    const data = svg('g', { 'clip-path': `url(#${clipId})` });

    if (type === 'bars') {
      const slot = innerW / domain;
      const barW = Math.max(1, Math.min(24, slot - 2));
      for (const point of points) {
        const v = value(point, series[0].key);
        if (!v) continue;
        const top0 = y(v);
        const barH = PAD.top + innerH - top0;
        const cx = x(point.t - 0.5);
        data.append(svg('rect', { class: `chart-bar tone-${series[0].tone}`, x: cx - barW / 2, y: top0, width: barW, height: Math.max(1, barH), rx: Math.min(2, barW / 2) }));
      }
    } else {
      for (const item of series) {
        const segments = [];
        let current = [];
        // Each point is drawn at the end of its second; a line starts at 0 s from its first value.
        for (const point of points) {
          const v = value(point, item.key);
          if (v === null) {
            if (current.length) segments.push(current);
            current = [];
            continue;
          }
          current.push([point.t, v]);
        }
        if (current.length) segments.push(current);
        for (const segment of segments) {
          let d = '';
          segment.forEach(([t, v], index) => {
            if (index === 0) d += `M${x(type === 'step' ? t - 1 : t).toFixed(1)},${y(v).toFixed(1)}`;
            if (type === 'step') d += `${index === 0 ? '' : `V${y(v).toFixed(1)}`}H${x(t).toFixed(1)}`;
            else if (index > 0) d += `L${x(t).toFixed(1)},${y(v).toFixed(1)}`;
          });
          // A second with answers between two without them is a point, not a line.
          if (segment.length === 1 && type !== 'step') {
            const [t, v] = segment[0];
            data.append(svg('circle', { class: `chart-dot tone-${item.tone}`, cx: x(t), cy: y(v), r: 3.5 }));
            continue;
          }
          if (type === 'area' || type === 'step') {
            const first = type === 'step' ? segment[0][0] - 1 : segment[0][0];
            const area = `${d}V${(PAD.top + innerH).toFixed(1)}H${x(first).toFixed(1)}Z`;
            data.append(svg('path', { class: `chart-area tone-${item.tone}`, d: area }));
          }
          data.append(svg('path', { class: `chart-line tone-${item.tone}`, d }));
        }
      }
      // The newest value gets an end dot while the test is live.
      const last = points.at(-1);
      if (last && options.live) {
        for (const item of series) {
          const v = value(last, item.key);
          if (v !== null) data.append(svg('circle', { class: `chart-dot tone-${item.tone}`, cx: x(last.t), cy: y(v), r: 4 }));
        }
      }
    }
    children.push(data);

    if (state.limit) {
      const yy = Math.round(y(state.limit.value)) + 0.5;
      children.push(svg('line', { class: 'chart-limit', x1: PAD.left, x2: PAD.left + innerW, y1: yy, y2: yy }));
      const label = svg('text', { class: 'chart-limit-label', x: PAD.left + innerW - 2, y: yy - 5, 'text-anchor': 'end' });
      label.textContent = state.limit.label;
      children.push(label);
    }
    if (state.marker && state.marker.t <= domain) {
      const xx = Math.round(x(state.marker.t)) + 0.5;
      children.push(svg('line', { class: 'chart-marker', x1: xx, x2: xx, y1: PAD.top, y2: PAD.top + innerH }));
      if (state.marker.label) {
        const nearEnd = xx > PAD.left + innerW * 0.7;
        const label = svg('text', { class: 'chart-marker-label', x: nearEnd ? xx - 6 : xx + 6, y: PAD.top + 10, 'text-anchor': nearEnd ? 'end' : 'start' });
        label.textContent = state.marker.label;
        children.push(label);
      }
    }

    // Crosshair on the focused second.
    const focus = state.focusT !== null ? state.points.find((point) => point.t === state.focusT) : null;
    if (focus) {
      const xx = Math.round(x(focus.t)) + 0.5;
      children.push(svg('line', { class: 'chart-cross', x1: xx, x2: xx, y1: PAD.top, y2: PAD.top + innerH }));
      if (type !== 'bars') {
        for (const item of series) {
          const v = value(focus, item.key);
          if (v !== null) children.push(svg('circle', { class: `chart-dot tone-${item.tone}`, cx: x(focus.t), cy: y(v), r: 4 }));
        }
      }
    }
    graphic.replaceChildren(...children);
    state.geometry = { x, innerW, domain };
  }

  function drawNow() {
    if (anim) return;
    state.yTop = targetTop();
    draw(state.points, state.yTop);
  }

  // ---------- tooltip and crosshair ----------

  function renderTip(point) {
    if (!point || !state.hovered) {
      tooltip.hidden = true;
      return;
    }
    tooltip.replaceChildren(
      h('p', { class: 'chart-tip-time' }, formatClock(point.t)),
      ...series.map((item) =>
        h('p', { class: 'chart-tip-row', dataset: { tone: item.tone } }, h('span', { class: 'chart-key chart-key-line', 'aria-hidden': 'true' }), h('strong', {}, value(point, item.key) === null ? '–' : format(value(point, item.key))), h('span', {}, item.label)),
      ),
    );
    tooltip.hidden = false;
    const { x } = state.geometry || {};
    if (!x) return;
    const px = x(point.t);
    const tipW = tooltip.offsetWidth || 120;
    const left = px + 12 + tipW > state.width ? px - 12 - tipW : px + 12;
    tooltip.style.transform = `translate(${Math.max(0, left).toFixed(0)}px, 6px)`;
  }

  function showAt(t, hovered) {
    state.focusT = t;
    state.hovered = hovered;
    if (!anim) draw(state.points, state.yTop ?? targetTop());
    renderTip(t === null ? null : state.points.find((point) => point.t === t));
  }

  function pointAtX(clientX) {
    const geometry = state.geometry;
    if (!geometry || !state.points.length) return null;
    const rect = plot.getBoundingClientRect();
    const t = Math.round(((clientX - rect.left - PAD.left) / geometry.innerW) * geometry.domain);
    const first = state.points[0].t;
    const last = state.points.at(-1).t;
    return Math.max(first, Math.min(last, t));
  }

  plot.addEventListener('pointermove', (event) => {
    const t = pointAtX(event.clientX);
    if (t === null) return;
    if (chart.group) chart.group.focus(t, chart);
    else showAt(t, true);
  });
  plot.addEventListener('pointerleave', () => (chart.group ? chart.group.clear() : showAt(null, false)));
  plot.addEventListener('blur', () => (chart.group ? chart.group.clear() : showAt(null, false)));
  plot.addEventListener('keydown', (event) => {
    if (!state.points.length) return;
    const first = state.points[0].t;
    const last = state.points.at(-1).t;
    let t = state.focusT ?? last;
    if (event.key === 'ArrowLeft') t = Math.max(first, (state.focusT ?? last + 1) - 1);
    else if (event.key === 'ArrowRight') t = Math.min(last, (state.focusT ?? first - 1) + 1);
    else if (event.key === 'Home') t = first;
    else if (event.key === 'End') t = last;
    else if (event.key === 'Escape') return chart.group ? chart.group.clear() : showAt(null, false);
    else return;
    event.preventDefault();
    if (chart.group) chart.group.focus(t, chart);
    else showAt(t, true);
  });

  // ---------- updates ----------

  function updateLegend() {
    const last = state.points.at(-1);
    for (const item of series) {
      const v = value(last, item.key);
      legendValues.get(item.key).textContent = v === null ? '–' : format(v);
    }
  }

  /** Adds or replaces points (sorted by t). With `animate`, the newest segment grows in and the scale eases. */
  function setPoints(points, { animate = false } = {}) {
    const previousLast = state.points.at(-1) || null;
    state.points = points;
    updateLegend();
    const top = targetTop();
    const last = points.at(-1);
    if (!animate || !motionOK() || !state.width || !last) {
      cancelAnimationFrame(anim);
      anim = null;
      state.yTop = top;
      draw(points, top);
      shownLast = last;
      return;
    }
    const fromTop = state.yTop ?? top;
    const from = shownLast && shownLast.t < last.t ? shownLast : previousLast && previousLast.t < last.t ? previousLast : { ...last, t: last.t - 1, ...Object.fromEntries(series.map((item) => [item.key, type === 'bars' ? 0 : value(last, item.key)])) };
    cancelAnimationFrame(anim);
    const startedAt = performance.now();
    const frame = (now) => {
      const progress = Math.min(1, (now - startedAt) / TWEEN_MS);
      const e = ease(progress);
      const head = { t: from.t + (last.t - from.t) * e };
      for (const item of series) {
        const a = value(from, item.key);
        const b = value(last, item.key);
        head[item.key] = a === null || b === null ? b : a + (b - a) * e;
      }
      state.yTop = fromTop + (top - fromTop) * e;
      draw([...points.slice(0, -1), head], state.yTop);
      if (progress < 1) anim = requestAnimationFrame(frame);
      else {
        anim = null;
        shownLast = last;
        draw(points, top);
      }
    };
    anim = requestAnimationFrame(frame);
  }

  /** Draws stored points with a left-to-right reveal. */
  function reveal(points) {
    state.points = points;
    updateLegend();
    state.yTop = targetTop();
    shownLast = points.at(-1) || null;
    if (!motionOK() || !state.width) return draw(points, state.yTop);
    cancelAnimationFrame(anim);
    const startedAt = performance.now();
    const frame = (now) => {
      const progress = Math.min(1, (now - startedAt) / REVEAL_MS);
      draw(points, state.yTop, ease(progress));
      anim = progress < 1 ? requestAnimationFrame(frame) : null;
    };
    anim = requestAnimationFrame(frame);
  }

  // Charts are drawn at their real pixel width, so text stays crisp and the same size on a phone.
  const observer = new ResizeObserver(() => {
    const width = Math.round(plot.clientWidth);
    if (width && width !== state.width) {
      state.width = width;
      if (!anim) draw(state.points, state.yTop ?? targetTop());
    }
  });
  observer.observe(plot);
  el.dataset.uid = `chart${Math.random().toString(36).slice(2, 8)}`;

  const chart = {
    el,
    group: null,
    showAt,
    setPoints,
    reveal,
    setDomain(seconds) {
      state.domain = Math.max(1, seconds);
      drawNow();
    },
    setLimit(limit) {
      state.limit = limit;
      drawNow();
    },
    setMarker(marker) {
      state.marker = marker;
      drawNow();
    },
    destroy() {
      cancelAnimationFrame(anim);
      observer.disconnect();
    },
  };
  return chart;
}
