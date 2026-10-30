import type { Directive } from 'vue';

/**
 * v-tilt: gives an element a subtle 3D tilt that follows the pointer, plus a light glare
 * (add <span class="tilt-glare" /> inside the element to show it).
 * Skipped for touch screens and for people who prefer reduced motion.
 *
 * Usage: v-tilt or v-tilt="{ max: 8 }"
 */
type TiltOptions = { max?: number; scale?: number };
type TiltElement = HTMLElement & { __tiltCleanup?: () => void };

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = () => window.matchMedia('(pointer: fine)').matches;

export const vTilt: Directive<TiltElement, TiltOptions | undefined> = {
    mounted(el, binding) {
        if (reducedMotion() || !finePointer()) return;

        const max = binding.value?.max ?? 6;
        const scale = binding.value?.scale ?? 1.015;
        let frame = 0;

        el.style.transformStyle = 'preserve-3d';
        el.style.transition = 'transform 0.4s cubic-bezier(0.22, 1, 0.36, 1)';
        el.style.willChange = 'transform';

        const onMove = (event: PointerEvent) => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                const rect = el.getBoundingClientRect();
                const x = (event.clientX - rect.left) / rect.width;
                const y = (event.clientY - rect.top) / rect.height;
                el.dataset.tilting = 'true';
                el.style.transition = 'transform 0.08s linear';
                el.style.transform = `perspective(900px) rotateX(${(0.5 - y) * max}deg) rotateY(${(x - 0.5) * max}deg) scale(${scale})`;
                el.style.setProperty('--glare-x', `${x * 100}%`);
                el.style.setProperty('--glare-y', `${y * 100}%`);
            });
        };
        const onLeave = () => {
            cancelAnimationFrame(frame);
            el.dataset.tilting = 'false';
            el.style.transition = 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)';
            el.style.transform = '';
        };

        el.addEventListener('pointermove', onMove);
        el.addEventListener('pointerleave', onLeave);
        el.__tiltCleanup = () => {
            cancelAnimationFrame(frame);
            el.removeEventListener('pointermove', onMove);
            el.removeEventListener('pointerleave', onLeave);
        };
    },
    unmounted(el) {
        el.__tiltCleanup?.();
    },
};
