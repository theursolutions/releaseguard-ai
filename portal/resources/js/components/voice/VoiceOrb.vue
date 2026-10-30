<script setup lang="ts">
/**
 * The central "sound field": a HUD of rotating tick rings and arc segments around layered rings
 * that deform around a glowing core, with a radial spectrum and orbiting particles.
 *
 * Nothing here is simulated. `state` comes from real assistant events. `level` (0–1) is real signal:
 * microphone loudness while LISTENING, speech word-boundary pulses while SPEAKING. `spectrum` reads the
 * live microphone frequency bands; the spectrum ring shows them only while the microphone is open.
 * The rotation, particles and breathing are ambient motion and never imply that work is happening.
 * Reduced motion: a still, state-coloured orb redrawn only when state or level changes.
 */
import type { AssistantState } from '@/composables/useVoiceAssistant';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{ state: AssistantState; level: number; spectrum?: (out: Uint8Array) => boolean }>();

const canvas = ref<HTMLCanvasElement | null>(null);
let ctx: CanvasRenderingContext2D | null = null;
let frame = 0;
let width = 0;
let height = 0;
let smoothLevel = 0;
let running = false;
let resizeObserver: ResizeObserver | null = null;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// [core rgb, ring rgb, accent rgb, how strongly rings react, ring rotation speed]
const PALETTE: Record<AssistantState, { core: string; ring: string; accent: string; react: number; spin: number }> = {
    IDLE: { core: '56, 189, 248', ring: '125, 211, 252', accent: '129, 140, 248', react: 0.25, spin: 0.05 },
    LISTENING: { core: '34, 211, 238', ring: '103, 232, 249', accent: '45, 212, 191', react: 1.25, spin: 0.08 },
    PROCESSING: { core: '59, 130, 246', ring: '147, 197, 253', accent: '99, 102, 241', react: 0.35, spin: 0.6 },
    ANALYZING: { core: '99, 102, 241', ring: '165, 180, 252', accent: '192, 132, 252', react: 0.4, spin: 0.9 },
    RESPONDING: { core: '45, 212, 191', ring: '153, 246, 228', accent: '56, 189, 248', react: 0.5, spin: 0.25 },
    SPEAKING: { core: '125, 211, 252', ring: '224, 242, 254', accent: '167, 139, 250', react: 1.1, spin: 0.15 },
    INTERRUPTED: { core: '251, 191, 36', ring: '253, 230, 138', accent: '251, 146, 60', react: 0.15, spin: 0.02 },
    ERROR: { core: '244, 63, 94', ring: '253, 164, 175', accent: '251, 113, 133', react: 0.1, spin: 0.01 },
};

const BARS = 72;
const bins = new Uint8Array(256);
const bars = new Float32Array(BARS);
const PARTICLES = Array.from({ length: 46 }, () => ({
    angle: Math.random() * Math.PI * 2,
    radius: 1.55 + Math.random() * 0.75,
    speed: (0.05 + Math.random() * 0.18) * (Math.random() < 0.5 ? -1 : 1),
    size: 0.6 + Math.random() * 1.4,
    phase: Math.random() * Math.PI * 2,
}));

// Smooth pseudo-noise from layered sines: cheap and seamless around the circle.
function wobble(angle: number, t: number, layer: number) {
    return (
        Math.sin(angle * 3 + t * 1.1 + layer) * 0.5 +
        Math.sin(angle * 5 - t * 1.7 + layer * 2.1) * 0.3 +
        Math.sin(angle * 9 + t * 2.3 + layer * 0.7) * 0.2
    );
}

/** Bar heights (0–1): the measured microphone bands, mirrored left/right; otherwise they settle to zero. */
function updateBars(energy: number) {
    const live = props.state === 'LISTENING' && props.spectrum?.(bins);
    const half = BARS / 2;
    for (let i = 0; i < BARS; i++) {
        let target = 0;
        if (live) {
            const k = i < half ? i : BARS - 1 - i;
            // Speech sits in the lower bands: spread bins 2–60 over the half circle, low notes at the top.
            target = bins[2 + Math.floor((k / half) ** 1.4 * 58)] / 255;
        } else if (props.state === 'SPEAKING') {
            // Browser speech gives no audio, only word-boundary pulses: show their measured level evenly.
            target = energy * (0.55 + 0.45 * Math.abs(Math.sin(i * 0.9)));
        }
        bars[i] += (target - bars[i]) * (target > bars[i] ? 0.5 : 0.12);
    }
}

function draw(time: number) {
    if (!ctx) return;
    const t = reducedMotion ? 0 : time / 1000;
    const palette = PALETTE[props.state];
    smoothLevel += (props.level - smoothLevel) * 0.18;
    const energy = Math.min(1, smoothLevel);
    updateBars(energy);

    ctx.clearRect(0, 0, width, height);
    const cx = width / 2;
    const cy = height / 2;
    const base = Math.min(width, height) * 0.2;
    const breathe = reducedMotion ? 0 : Math.sin(t * 1.2) * 0.015;

    // Outer haze
    const haze = ctx.createRadialGradient(cx, cy, base * 0.2, cx, cy, base * 2.5);
    haze.addColorStop(0, `rgba(${palette.core}, ${0.24 + energy * 0.2})`);
    haze.addColorStop(0.6, `rgba(${palette.accent}, 0.06)`);
    haze.addColorStop(1, 'rgba(2, 6, 23, 0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, width, height);

    ctx.lineCap = 'round';

    // HUD: fine tick ring with a brighter tick every 15°, rotating slowly.
    const tickRadius = base * 2.32;
    const ticks = 120;
    for (let i = 0; i < ticks; i++) {
        const a = (i / ticks) * Math.PI * 2 + t * 0.04;
        const major = i % 10 === 0;
        const inner = tickRadius - (major ? base * 0.09 : base * 0.04);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
        ctx.lineTo(cx + Math.cos(a) * tickRadius, cy + Math.sin(a) * tickRadius);
        ctx.strokeStyle = `rgba(${palette.ring}, ${major ? 0.5 : 0.16})`;
        ctx.lineWidth = major ? 1.4 : 1;
        ctx.stroke();
    }

    // HUD: three arc segments counter-rotating, and a thin full ring.
    ctx.beginPath();
    ctx.arc(cx, cy, base * 2.12, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(${palette.ring}, 0.1)`;
    ctx.lineWidth = 1;
    ctx.stroke();
    for (let i = 0; i < 3; i++) {
        const start = -t * 0.18 + (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.arc(cx, cy, base * 2.12, start, start + Math.PI * 0.38);
        ctx.strokeStyle = `rgba(${palette.accent}, 0.55)`;
        ctx.lineWidth = 2.2;
        ctx.stroke();
    }

    ctx.globalCompositeOperation = 'lighter';

    // Particles orbiting the field.
    for (const p of PARTICLES) {
        const a = p.angle + t * p.speed * (1 + palette.spin);
        const r = base * (p.radius + Math.sin(t * 0.8 + p.phase) * 0.05);
        ctx.beginPath();
        ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, p.size, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${palette.ring}, ${0.25 + 0.35 * Math.abs(Math.sin(t + p.phase))})`;
        ctx.fill();
    }

    // Spectrum ring: real microphone bands while listening, speech pulses while speaking.
    const barInner = base * 1.62;
    for (let i = 0; i < BARS; i++) {
        const value = bars[i];
        const a = (i / BARS) * Math.PI * 2 - Math.PI / 2;
        const length = base * (0.03 + value * 0.55);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * barInner, cy + Math.sin(a) * barInner);
        ctx.lineTo(cx + Math.cos(a) * (barInner + length), cy + Math.sin(a) * (barInner + length));
        ctx.strokeStyle = `rgba(${value > 0.05 ? palette.accent : palette.ring}, ${0.18 + value * 0.75})`;
        ctx.lineWidth = Math.max(1.5, (base * 0.045) * (0.6 + value));
        ctx.stroke();
    }

    // Rings
    const rings = 5;
    for (let layer = 0; layer < rings; layer++) {
        const radius = base * (1.05 + layer * 0.12) * (1 + breathe);
        const amplitude = base * (0.015 + palette.react * (0.02 + energy * 0.16)) * (1 - layer * 0.08);
        const rotation = t * palette.spin * (layer % 2 ? -1 : 1);
        ctx.beginPath();
        const steps = 150;
        for (let i = 0; i <= steps; i++) {
            const angle = (i / steps) * Math.PI * 2;
            const r = radius + wobble(angle + rotation, t, layer) * amplitude;
            const x = cx + Math.cos(angle) * r;
            const y = cy + Math.sin(angle) * r;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = `rgba(${layer % 2 ? palette.accent : palette.ring}, ${0.5 - layer * 0.07})`;
        ctx.lineWidth = 1.4 + (layer === 0 ? 0.8 : 0);
        ctx.shadowColor = `rgba(${palette.core}, 0.8)`;
        ctx.shadowBlur = 14;
        ctx.stroke();
    }
    ctx.shadowBlur = 0;

    // Activity arc: only in PROCESSING / ANALYZING, i.e. while a real request is running.
    if (props.state === 'PROCESSING' || props.state === 'ANALYZING') {
        const start = t * (props.state === 'ANALYZING' ? 2.6 : 1.8);
        ctx.beginPath();
        ctx.arc(cx, cy, base * 1.95, start, start + Math.PI * 0.6);
        ctx.strokeStyle = `rgba(${palette.ring}, 0.9)`;
        ctx.lineWidth = 2.4;
        ctx.stroke();
        if (props.state === 'ANALYZING') {
            for (let i = 0; i < 3; i++) {
                const a = start * 1.3 + (i * Math.PI * 2) / 3;
                ctx.beginPath();
                ctx.arc(cx + Math.cos(a) * base * 1.45, cy + Math.sin(a) * base * 1.45, 3, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${palette.ring}, 0.95)`;
                ctx.fill();
            }
        }
    }

    // Core: glass sphere with a slow inner swirl and a bright sheen.
    ctx.globalCompositeOperation = 'source-over';
    const coreRadius = base * (0.8 + energy * 0.12 + breathe);
    const core = ctx.createRadialGradient(cx - coreRadius * 0.3, cy - coreRadius * 0.35, coreRadius * 0.08, cx, cy, coreRadius);
    core.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
    core.addColorStop(0.3, `rgba(${palette.ring}, 0.8)`);
    core.addColorStop(0.75, `rgba(${palette.core}, 0.35)`);
    core.addColorStop(1, `rgba(${palette.accent}, 0.12)`);
    ctx.beginPath();
    ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
    ctx.fillStyle = core;
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 3; i++) {
        const a = t * (0.3 + i * 0.15) + (i * Math.PI * 2) / 3;
        const swirl = ctx.createRadialGradient(cx + Math.cos(a) * coreRadius * 0.45, cy + Math.sin(a) * coreRadius * 0.45, 0, cx + Math.cos(a) * coreRadius * 0.45, cy + Math.sin(a) * coreRadius * 0.45, coreRadius * 0.7);
        swirl.addColorStop(0, `rgba(${palette.accent}, ${0.22 + energy * 0.25})`);
        swirl.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = swirl;
        ctx.fillRect(cx - coreRadius, cy - coreRadius, coreRadius * 2, coreRadius * 2);
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.25 + energy * 0.3})`;
    ctx.lineWidth = 1;
    ctx.stroke();
}

function loop(time: number) {
    if (!running) return;
    draw(time);
    frame = requestAnimationFrame(loop);
}

function resize() {
    if (!canvas.value) return;
    const rect = canvas.value.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas.value.width = Math.round(width * dpr);
    canvas.value.height = Math.round(height * dpr);
    ctx = canvas.value.getContext('2d');
    ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!running) draw(performance.now());
}

function start() {
    if (reducedMotion || running || document.hidden) return;
    running = true;
    frame = requestAnimationFrame(loop);
}
function stop() {
    running = false;
    cancelAnimationFrame(frame);
}
const onVisibility = () => (document.hidden ? stop() : start());

onMounted(() => {
    resize();
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas.value!);
    document.addEventListener('visibilitychange', onVisibility);
    start();
});

// With reduced motion, redraw only when something real changes.
watch(
    () => [props.state, props.level],
    () => {
        if (!running) {
            smoothLevel = props.level;
            draw(performance.now());
        }
    },
);

onBeforeUnmount(() => {
    stop();
    resizeObserver?.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
});
</script>

<template>
    <canvas ref="canvas" class="block size-full" aria-hidden="true" />
</template>
