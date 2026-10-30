import { onMounted, ref } from 'vue';

type Appearance = 'light' | 'dark' | 'system';

export function updateTheme(value: Appearance) {
    if (value === 'system') {
        const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
        document.documentElement.classList.toggle('dark', systemTheme === 'dark');
    } else {
        document.documentElement.classList.toggle('dark', value === 'dark');
    }
}

const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

// ReleaseGuard's command-center look is dark; light stays available under Settings → Appearance.
const DEFAULT_APPEARANCE: Appearance = 'dark';

const handleSystemThemeChange = () => {
    const currentAppearance = localStorage.getItem('appearance') as Appearance | null;
    updateTheme(currentAppearance || DEFAULT_APPEARANCE);
};

export function initializeTheme() {
    const savedAppearance = localStorage.getItem('appearance') as Appearance | null;
    updateTheme(savedAppearance || DEFAULT_APPEARANCE);

    // Set up system theme change listener...
    mediaQuery.addEventListener('change', handleSystemThemeChange);
}

export function useAppearance() {
    const appearance = ref<Appearance>(DEFAULT_APPEARANCE);

    onMounted(() => {
        initializeTheme();

        const savedAppearance = localStorage.getItem('appearance') as Appearance | null;

        if (savedAppearance) {
            appearance.value = savedAppearance;
        }
    });

    function updateAppearance(value: Appearance) {
        appearance.value = value;
        localStorage.setItem('appearance', value);
        updateTheme(value);
    }

    return {
        appearance,
        updateAppearance,
    };
}
