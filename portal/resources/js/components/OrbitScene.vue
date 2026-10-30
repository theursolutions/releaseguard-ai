<script setup lang="ts">
/**
 * 3D "system orbit": a glowing core with one orbiting node per system, coloured by live status.
 *
 * Performance: three.js is loaded only when this component mounts (separate chunk), rendering pauses
 * when the scene is off-screen or the tab is hidden, the pixel ratio is capped at 2, and every GPU
 * resource is disposed on unmount. Accessibility: the canvas is decorative (aria-hidden); the node
 * list is real HTML. Reduced motion renders a single still frame. No WebGL → CSS fallback.
 */
import { cn } from '@/lib/utils';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

export type OrbitStatus = 'ok' | 'warning' | 'critical' | 'idle';
export interface OrbitNode {
    id: string;
    label: string;
    status: OrbitStatus;
    detail?: string;
}

const props = withDefaults(defineProps<{ nodes: OrbitNode[]; class?: string; coreLabel?: string }>(), { coreLabel: 'ReleaseGuard' });

const container = ref<HTMLDivElement | null>(null);
const canvasHost = ref<HTMLDivElement | null>(null);
const labelRefs = ref<HTMLElement[]>([]);
const fallback = ref(false);
const ready = ref(false);

const COLORS: Record<OrbitStatus, number> = { ok: 0x10b981, warning: 0xf59e0b, critical: 0xef4444, idle: 0x94a3b8 };
const DOTS: Record<OrbitStatus, string> = { ok: 'bg-emerald-500', warning: 'bg-amber-500', critical: 'bg-red-500', idle: 'bg-slate-400' };
const worst = computed<OrbitStatus>(() =>
    props.nodes.some((n) => n.status === 'critical') ? 'critical' : props.nodes.some((n) => n.status === 'warning') ? 'warning' : 'ok',
);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let THREE: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let renderer: any, scene: any, camera: any, root: any, core: any, shell: any, field: any, clock: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nodeObjects: { mesh: any; halo: any; link: any; spark: any; radius: number; speed: number; phase: number; tilt: number; status: OrbitStatus }[] = [];
let frame = 0;
let visible = true;
let running = false;
let pointerX = 0;
let pointerY = 0;
const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
let resizeObserver: ResizeObserver | null = null;
let intersectionObserver: IntersectionObserver | null = null;

function glowTexture() {
    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
}

function buildNodes() {
    nodeObjects.forEach(({ mesh, halo, link, spark }) => {
        root.remove(mesh, halo, link, spark);
        mesh.geometry.dispose();
        mesh.material.dispose();
        halo.material.dispose();
        link.geometry.dispose();
        link.material.dispose();
        spark.geometry.dispose();
        spark.material.dispose();
    });
    nodeObjects = [];
    const texture = glowTexture();

    props.nodes.forEach((node, index) => {
        const color = COLORS[node.status];
        const mesh = new THREE.Mesh(
            new THREE.SphereGeometry(0.3, 32, 32),
            new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.45, roughness: 0.3, metalness: 0.2 }),
        );
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, color, transparent: true, opacity: 0.55, depthWrite: false }));
        halo.scale.setScalar(1.6);
        const link = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
            new THREE.LineBasicMaterial({ color: 0x6366f1, transparent: true, opacity: 0.25 }),
        );
        const spark = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), new THREE.MeshBasicMaterial({ color: 0x3b82f6 }));
        root.add(mesh, halo, link, spark);
        nodeObjects.push({
            mesh, halo, link, spark,
            radius: index % 2 === 0 ? 3.3 : 4.0,
            speed: 0.12 + (index % 3) * 0.03,
            phase: (index / Math.max(1, props.nodes.length)) * Math.PI * 2,
            tilt: index % 2 === 0 ? 0.35 : -0.25,
            status: node.status,
        });
    });
}

function applyStatusColors() {
    const coreColor = COLORS[worst.value === 'ok' ? 'ok' : worst.value];
    core.material.color.setHex(worst.value === 'ok' ? 0x2563eb : coreColor);
    core.material.emissive.setHex(worst.value === 'ok' ? 0x1d4ed8 : coreColor);
    props.nodes.forEach((node, i) => {
        const obj = nodeObjects[i];
        if (!obj) return;
        obj.status = node.status;
        obj.mesh.material.color.setHex(COLORS[node.status]);
        obj.mesh.material.emissive.setHex(COLORS[node.status]);
        obj.halo.material.color.setHex(COLORS[node.status]);
    });
}

function renderFrame(time: number) {
    root.rotation.y += (pointerX * 0.35 - root.rotation.y) * 0.05;
    root.rotation.x += (pointerY * 0.2 - root.rotation.x) * 0.05;
    core.rotation.y = time * 0.25;
    shell.rotation.y = -time * 0.15;
    shell.rotation.x = time * 0.1;
    field.rotation.y = time * 0.02;
    const pulse = 1 + Math.sin(time * 2.2) * 0.04;
    core.scale.setScalar(pulse);

    nodeObjects.forEach((obj) => {
        const angle = obj.phase + time * obj.speed;
        const x = Math.cos(angle) * obj.radius;
        const z = Math.sin(angle) * obj.radius;
        const y = Math.sin(angle) * obj.radius * obj.tilt;
        obj.mesh.position.set(x, y, z);
        obj.halo.position.set(x, y, z);
        const critical = obj.status === 'critical';
        const beat = critical ? 1 + Math.abs(Math.sin(time * 4)) * 0.45 : 1;
        obj.mesh.scale.setScalar(beat);
        obj.halo.scale.setScalar((critical ? 2.4 : 1.6) * beat);
        obj.link.geometry.setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(x, y, z)]);
        const t = (time * (critical ? 0.9 : 0.45) + obj.phase) % 1;
        obj.spark.position.set(x * t, y * t, z * t);
        obj.spark.material.color.setHex(critical ? 0xef4444 : 0x3b82f6);
    });

    renderer.render(scene, camera);
    positionLabels();
}

function positionLabels() {
    if (!container.value) return;
    const { clientWidth: w, clientHeight: h } = container.value;
    nodeObjects.forEach((obj, i) => {
        const el = labelRefs.value[i];
        if (!el) return;
        const v = obj.mesh.position.clone().applyMatrix4(root.matrixWorld).project(camera);
        el.style.transform = `translate(-50%, -150%) translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px)`;
        el.style.opacity = v.z < 1 ? '1' : '0';
        el.style.zIndex = String(Math.round((1 - v.z) * 100));
    });
}

function loop() {
    if (!running) return;
    renderFrame(clock.getElapsedTime());
    frame = requestAnimationFrame(loop);
}

function updateRunning() {
    const shouldRun = visible && !document.hidden && !reducedMotion && ready.value;
    if (shouldRun && !running) {
        running = true;
        frame = requestAnimationFrame(loop);
    } else if (!shouldRun && running) {
        running = false;
        cancelAnimationFrame(frame);
    }
}

function resize() {
    if (!container.value || !renderer) return;
    const { clientWidth: w, clientHeight: h } = container.value;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    if (!running) renderFrame(clock.getElapsedTime());
}

function onPointerMove(event: PointerEvent) {
    const rect = container.value!.getBoundingClientRect();
    pointerX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
    pointerY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
}

const onVisibility = () => updateRunning();

onMounted(async () => {
    try {
        THREE = await import('three');
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
        fallback.value = true;
        return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute('aria-hidden', 'true');
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    canvasHost.value!.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 2.2, 11);
    camera.lookAt(0, 0, 0);
    clock = new THREE.Clock();

    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(5, 6, 6);
    scene.add(key);
    const rim = new THREE.PointLight(0x8b5cf6, 18, 30);
    rim.position.set(-5, -2, 4);
    scene.add(rim);

    root = new THREE.Group();
    scene.add(root);

    core = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1.2, 4),
        new THREE.MeshStandardMaterial({ color: 0x2563eb, emissive: 0x1d4ed8, emissiveIntensity: 0.35, roughness: 0.25, metalness: 0.35 }),
    );
    shell = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.75, 1)),
        new THREE.LineBasicMaterial({ color: 0x6366f1, transparent: true, opacity: 0.55 }),
    );
    root.add(core, shell);

    [3.3, 4.0].forEach((radius, i) => {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.008, 8, 160), new THREE.MeshBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.45 }));
        ring.rotation.x = Math.PI / 2 - (i === 0 ? 0.35 : -0.25) * 0.9;
        root.add(ring);
    });

    const positions = new Float32Array(420 * 3);
    for (let i = 0; i < 420; i++) {
        const r = 5 + Math.random() * 3;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        positions.set([r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi) * 0.6, r * Math.sin(phi) * Math.sin(theta)], i * 3);
    }
    const fieldGeometry = new THREE.BufferGeometry();
    fieldGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    field = new THREE.Points(fieldGeometry, new THREE.PointsMaterial({ color: 0x6366f1, size: 0.035, transparent: true, opacity: 0.5 }));
    scene.add(field);

    buildNodes();
    applyStatusColors();
    ready.value = true;
    resize();

    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container.value!);
    intersectionObserver = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        updateRunning();
    });
    intersectionObserver.observe(container.value!);
    document.addEventListener('visibilitychange', onVisibility);
    container.value!.addEventListener('pointermove', onPointerMove);
    updateRunning();
});

watch(
    () => props.nodes.map((n) => `${n.id}:${n.status}`).join('|'),
    (next, previous) => {
        if (!ready.value) return;
        if (next.split('|').length !== (previous ?? '').split('|').length) buildNodes();
        applyStatusColors();
        if (!running) renderFrame(clock.getElapsedTime());
    },
);

onBeforeUnmount(() => {
    running = false;
    cancelAnimationFrame(frame);
    resizeObserver?.disconnect();
    intersectionObserver?.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    container.value?.removeEventListener('pointermove', onPointerMove);
    if (scene) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        scene.traverse((object: any) => {
            object.geometry?.dispose?.();
            const materials = Array.isArray(object.material) ? object.material : [object.material];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            materials.forEach((material: any) => {
                material?.map?.dispose?.();
                material?.dispose?.();
            });
        });
    }
    renderer?.dispose();
    renderer?.forceContextLoss?.();
});
</script>

<template>
    <div ref="container" :class="cn('relative overflow-hidden', props.class)">
        <div ref="canvasHost" class="absolute inset-0" />

        <!-- Labels follow the 3D nodes; the sr-only list below carries the same information. -->
        <div v-if="!fallback" class="pointer-events-none absolute inset-0" aria-hidden="true">
            <div
                v-for="(node, i) in nodes"
                :key="node.id"
                :ref="(el) => (labelRefs[i] = el as HTMLElement)"
                class="absolute left-0 top-0 whitespace-nowrap rounded-full border border-white/80 bg-white/80 px-2.5 py-1 text-xs font-medium text-slate-700 shadow-sm backdrop-blur transition-opacity dark:border-slate-400/15 dark:bg-slate-900/80 dark:text-slate-200"
            >
                <span :class="['mr-1.5 inline-block size-2 rounded-full', DOTS[node.status]]" />{{ node.label }}
            </div>
        </div>

        <div v-if="fallback" class="absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <div class="size-40 rounded-full bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500 opacity-80 blur-sm [animation:rg-float_5s_ease-in-out_infinite]" />
        </div>

        <ul class="sr-only">
            <li v-for="node in nodes" :key="node.id">{{ node.label }}: {{ node.status }}{{ node.detail ? `, ${node.detail}` : '' }}</li>
        </ul>
        <slot />
    </div>
</template>
