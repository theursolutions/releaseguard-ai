<script setup lang="ts">
/**
 * 3D performance galaxy: the company (or agency) is the core; agencies or agents orbit it as planets
 * sized by revenue, with their agents as moons. Colour is the win rate (green strong, amber middling,
 * rose weak, grey no closed leads). Hover shows the figures; click drills down.
 *
 * Performance: three.js loads only when this mounts (separate chunk), rendering pauses off-screen and
 * in hidden tabs, pixel ratio is capped at 2 and everything is disposed on unmount. Reduced motion:
 * one still frame. The canvas is decorative; the same data is in the accessible list below it.
 */
import { compact } from '@/lib/numbers';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

export interface GalaxyNode {
    id: number;
    name: string;
    kind: 'agency' | 'agent';
    value: number;
    rate: number | null;
    children?: GalaxyNode[];
}

const props = withDefaults(defineProps<{ nodes: GalaxyNode[]; coreLabel: string; currency: string; class?: string }>(), { class: '' });
const emit = defineEmits<{ (e: 'select', node: GalaxyNode): void }>();

const host = ref<HTMLDivElement | null>(null);
const tooltip = ref<{ x: number; y: number; node: GalaxyNode } | null>(null);
const fallback = ref(false);

let THREE: any = null;
let renderer: any, scene: any, camera: any, root: any, raycaster: any, pointer: any, core: any;
let bodies: { mesh: any; halo: any; orbit: any; node: GalaxyNode; radius: number; speed: number; phase: number; parent?: any; tilt: number }[] = [];
let disposables: any[] = [];
let frame = 0;
let running = false;
let visible = true;
let hovered: (typeof bodies)[number] | null = null;
let px = 0;
let py = 0;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let resizeObserver: ResizeObserver | null = null;
let intersectionObserver: IntersectionObserver | null = null;

function rateColor(rate: number | null): number {
    if (rate === null) return 0x64748b;
    if (rate >= 60) return 0x34d399;
    if (rate >= 30) return 0xfbbf24;
    return 0xfb7185;
}

function glowTexture() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.3, 'rgba(255,255,255,0.5)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    disposables.push(texture);
    return texture;
}

function track<T>(object: T): T {
    disposables.push(object);
    return object;
}

function clearBodies() {
    bodies.forEach((b) => {
        (b.parent ?? root).remove(b.mesh, b.halo);
        if (b.orbit) (b.parent ?? root).remove(b.orbit);
    });
    bodies = [];
    disposables.forEach((d) => d.dispose?.());
    disposables = [];
}

function build() {
    clearBodies();
    const texture = glowTexture();
    const max = Math.max(1, ...props.nodes.map((n) => n.value));
    const count = props.nodes.length;

    props.nodes.forEach((node, index) => {
        const share = Math.sqrt(node.value / max);
        const size = 0.16 + share * 0.34;
        const radius = 2.1 + (index % 3) * 0.75 + (count > 6 ? (index / count) * 0.6 : 0);
        const color = rateColor(node.rate);
        const mesh = new THREE.Mesh(track(new THREE.SphereGeometry(size, 24, 18)), track(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.4 })));
        const halo = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: texture, color, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending })));
        halo.scale.setScalar(size * 6);
        const ring = new THREE.Mesh(track(new THREE.RingGeometry(radius - 0.004, radius + 0.004, 128)), track(new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.12, side: THREE.DoubleSide })));
        ring.rotation.x = Math.PI / 2;
        root.add(mesh, halo, ring);
        const body = { mesh, halo, orbit: ring, node, radius, speed: 0.08 + 0.12 / (1 + index * 0.35), phase: (index / Math.max(1, count)) * Math.PI * 2, tilt: (index % 2 ? 1 : -1) * 0.12 };
        mesh.userData.body = body;
        bodies.push(body);

        (node.children ?? []).slice(0, 10).forEach((child, childIndex, all) => {
            const childSize = 0.05 + Math.sqrt(child.value / max) * 0.09;
            const childColor = rateColor(child.rate);
            const moon = new THREE.Mesh(track(new THREE.SphereGeometry(childSize, 12, 10)), track(new THREE.MeshStandardMaterial({ color: childColor, emissive: childColor, emissiveIntensity: 0.7 })));
            const moonHalo = new THREE.Sprite(track(new THREE.SpriteMaterial({ map: texture, color: childColor, transparent: true, opacity: 0.45, depthWrite: false, blending: THREE.AdditiveBlending })));
            moonHalo.scale.setScalar(childSize * 6);
            mesh.add(moon, moonHalo);
            const moonBody = { mesh: moon, halo: moonHalo, orbit: null, node: child, radius: size + 0.22 + childIndex * 0.035, speed: 0.6 + (childIndex % 3) * 0.2, phase: (childIndex / all.length) * Math.PI * 2, parent: mesh, tilt: 0.4 };
            moon.userData.body = moonBody;
            bodies.push(moonBody);
        });
    });
    place(0);
}

function place(t: number) {
    bodies.forEach((b) => {
        const angle = b.phase + t * b.speed;
        const x = Math.cos(angle) * b.radius;
        const z = Math.sin(angle) * b.radius;
        const y = Math.sin(angle * 2) * b.tilt;
        // Moons are children of their planet, so the same maths places them around it.
        b.mesh.position.set(x, y, z);
        b.halo.position.set(x, y, z);
    });
}

function renderFrame(time = 0) {
    const t = time / 1000;
    place(reducedMotion ? 0 : t);
    if (!reducedMotion) {
        root.rotation.y += ((px * 0.35) - root.rotation.y) * 0.04;
        root.rotation.x += ((0.38 + py * 0.15) - root.rotation.x) * 0.04;
        core.scale.setScalar(1 + Math.sin(t * 1.6) * 0.03);
    }
    renderer.render(scene, camera);
}

// About 30 frames a second is plenty for slow orbits and halves the GPU work on 60 Hz screens.
let lastFrame = 0;
function loop(time: number) {
    if (!running) return;
    if (time - lastFrame >= 33) {
        lastFrame = time;
        renderFrame(time);
    }
    frame = requestAnimationFrame(loop);
}

function start() {
    if (running || reducedMotion || !visible || document.hidden) return;
    running = true;
    frame = requestAnimationFrame(loop);
}

function stop() {
    running = false;
    cancelAnimationFrame(frame);
}

function onPointerMove(event: PointerEvent) {
    if (!host.value || !renderer) return;
    const rect = host.value.getBoundingClientRect();
    px = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    py = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    pointer.set(px, -py);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(bodies.map((b) => b.mesh), false)[0];
    hovered = hit ? hit.object.userData.body : null;
    tooltip.value = hovered ? { x: event.clientX - rect.left, y: event.clientY - rect.top, node: hovered.node } : null;
    host.value.style.cursor = hovered ? 'pointer' : 'default';
    if (reducedMotion) renderFrame();
}

function onClick() {
    if (hovered) emit('select', hovered.node);
}

function resize() {
    if (!host.value || !renderer) return;
    const { clientWidth: w, clientHeight: h } = host.value;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.position.z = w < 500 ? 9.5 : 7.4;
    camera.updateProjectionMatrix();
    renderFrame();
}

function onVisibility() {
    if (document.hidden) stop();
    else start();
}

onMounted(async () => {
    try {
        THREE = await import('three');
        const canvas = document.createElement('canvas');
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    } catch {
        fallback.value = true;
        return;
    }
    if (!host.value) return;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.domElement.setAttribute('aria-hidden', 'true');
    renderer.domElement.className = 'absolute inset-0 h-full w-full';
    host.value.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 7.4);
    root = new THREE.Group();
    root.rotation.x = 0.38;
    scene.add(root);
    scene.add(new THREE.AmbientLight(0x8fb4ff, 0.6));
    const light = new THREE.PointLight(0x22d3ee, 40, 30);
    scene.add(light);

    const texture = glowTexture();
    core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.62, 3), new THREE.MeshStandardMaterial({ color: 0x0ea5e9, emissive: 0x22d3ee, emissiveIntensity: 0.9, roughness: 0.2, metalness: 0.6, wireframe: false }));
    const wire = new THREE.Mesh(new THREE.IcosahedronGeometry(0.8, 1), new THREE.MeshBasicMaterial({ color: 0x67e8f9, wireframe: true, transparent: true, opacity: 0.18 }));
    const coreHalo = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color: 0x22d3ee, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
    coreHalo.scale.setScalar(4.2);
    root.add(core, wire, coreHalo);

    // Star field
    const stars = new THREE.BufferGeometry();
    const positions = new Float32Array(600 * 3);
    for (let i = 0; i < positions.length; i++) positions[i] = (Math.random() - 0.5) * 30;
    stars.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    scene.add(new THREE.Points(stars, new THREE.PointsMaterial({ color: 0x93c5fd, size: 0.03, transparent: true, opacity: 0.55 })));

    raycaster = new THREE.Raycaster();
    pointer = new THREE.Vector2();
    build();

    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host.value);
    intersectionObserver = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible) start();
        else stop();
    });
    intersectionObserver.observe(host.value);
    document.addEventListener('visibilitychange', onVisibility);
    resize();
    start();
});

watch(() => props.nodes, () => {
    if (!THREE || !root) return;
    build();
    renderFrame();
});

onBeforeUnmount(() => {
    stop();
    resizeObserver?.disconnect();
    intersectionObserver?.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    if (scene) {
        clearBodies();
        scene.traverse((object: { geometry?: { dispose(): void }; material?: { dispose(): void; map?: { dispose(): void } } }) => {
            object.geometry?.dispose();
            object.material?.map?.dispose();
            object.material?.dispose();
        });
    }
    renderer?.dispose();
});
</script>

<template>
    <div :class="['relative overflow-hidden', props.class]">
        <div ref="host" class="absolute inset-0" @pointermove="onPointerMove" @pointerleave="tooltip = null" @click="onClick" />
        <div v-if="fallback" class="absolute inset-0 grid place-items-center text-xs text-muted-foreground">3D view unavailable on this device.</div>
        <div class="pointer-events-none absolute left-4 top-3">
            <p class="hud-label">Performance galaxy</p>
            <p class="text-sm font-medium">{{ coreLabel }}</p>
        </div>
        <div class="pointer-events-none absolute bottom-3 left-4 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
            <span class="flex items-center gap-1"><span class="size-2 rounded-full bg-emerald-400" /> win rate ≥ 60%</span>
            <span class="flex items-center gap-1"><span class="size-2 rounded-full bg-amber-400" /> 30–60%</span>
            <span class="flex items-center gap-1"><span class="size-2 rounded-full bg-rose-400" /> &lt; 30%</span>
            <span class="flex items-center gap-1"><span class="size-2 rounded-full bg-slate-500" /> no closed leads</span>
        </div>
        <div
            v-if="tooltip"
            class="pointer-events-none absolute z-10 min-w-40 -translate-x-1/2 -translate-y-[115%] rounded-lg border border-cyan-400/30 bg-slate-950/90 px-3 py-2 text-xs text-slate-100 shadow-[0_10px_30px_-10px_rgba(34,211,238,0.5)] backdrop-blur"
            :style="{ left: `${tooltip.x}px`, top: `${tooltip.y}px` }"
        >
            <p class="font-medium">{{ tooltip.node.name }}</p>
            <p class="text-slate-400">{{ tooltip.node.kind === 'agency' ? 'Agency' : 'Agent' }} · {{ currency }} {{ compact(tooltip.node.value) }} won</p>
            <p class="text-slate-400">Win rate {{ tooltip.node.rate === null ? '—' : `${tooltip.node.rate}%` }}</p>
            <p v-if="tooltip.node.kind === 'agency' || tooltip.node.children" class="mt-1 text-cyan-300">Click to open</p>
        </div>
        <ul class="sr-only">
            <li v-for="node in nodes" :key="`${node.kind}-${node.id}`">{{ node.name }}: {{ currency }} {{ compact(node.value) }} won, win rate {{ node.rate ?? 'not available' }}</li>
        </ul>
    </div>
</template>
