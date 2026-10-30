/**
 * Browser dictation into a text field (Web Speech API). `listening` is true only between the
 * recogniser's real start and end events; the text is handed over when recognition ends.
 */
import { onBeforeUnmount, ref } from 'vue';

export function useDictation(options: { lang: () => string; onText: (text: string) => void }) {
    const Recognition = (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition ??
        (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    const supported = Boolean(Recognition);
    const listening = ref(false);
    const interim = ref('');
    const error = ref('');

    let recognition: any = null;
    let finalText = '';
    let cancelled = false;

    function start() {
        if (!supported || listening.value) return;
        error.value = '';
        interim.value = '';
        finalText = '';
        cancelled = false;
        recognition = new (Recognition as any)();
        recognition.lang = options.lang();
        recognition.interimResults = true;
        recognition.continuous = false;
        recognition.onstart = () => (listening.value = true);
        recognition.onresult = (event: any) => {
            let draft = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (event.results[i].isFinal) finalText += event.results[i][0].transcript;
                else draft += event.results[i][0].transcript;
            }
            interim.value = (finalText + draft).trim();
        };
        recognition.onerror = (event: any) => {
            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') error.value = 'Microphone access was blocked. Allow it in the browser, or type the correction.';
            else if (event.error === 'network') error.value = 'The browser speech service could not be reached. Type the correction instead.';
            else if (event.error === 'audio-capture') error.value = 'No microphone was found.';
        };
        recognition.onend = () => {
            listening.value = false;
            interim.value = '';
            if (!cancelled && finalText.trim()) options.onText(finalText.trim());
        };
        recognition.start();
    }

    /** Finish and hand over what was heard. */
    function stop() {
        recognition?.stop();
    }

    /** Stop without using what was heard. */
    function cancel() {
        cancelled = true;
        recognition?.abort?.();
    }

    onBeforeUnmount(cancel);

    return { supported, listening, interim, error, start, stop, cancel };
}
