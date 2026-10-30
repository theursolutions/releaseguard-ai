/**
 * Voice assistant state machine. Every state change is caused by a real event:
 *   LISTENING    speech recogniser started (the level and spectrum come from the measured microphone signal)
 *   PROCESSING   final transcript received / request sent, waiting for the server
 *   ANALYZING    the server reported that a business-data tool is running
 *   RESPONDING   the first answer text arrived
 *   SPEAKING     browser speech synthesis started (level pulses on its word-boundary events)
 *   INTERRUPTED  the user stopped playback or generation, held until the next user action
 *   ERROR        a real failure, held until the next user action
 * There are no timers that pretend work is happening.
 */
import { onBeforeUnmount, reactive, ref, watch, type Ref } from 'vue';

export type AssistantState = 'IDLE' | 'LISTENING' | 'PROCESSING' | 'ANALYZING' | 'RESPONDING' | 'SPEAKING' | 'INTERRUPTED' | 'ERROR';
export type ConnectionState = 'connecting' | 'connected' | 'auth_required' | 'error';

export interface ToolUse {
    name: string;
    ok: boolean;
}
export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    status: 'streaming' | 'complete' | 'interrupted' | 'error';
    tools: ToolUse[];
}
export interface VoiceSettings {
    autoSpeak: 'voice' | 'always' | 'never';
    voiceURI: string;
    rate: number;
    lang: string;
}

type RecognitionInstance = any;

const SETTINGS_KEY = 'releaseguard.voice.settings';

export function csrfToken(): string {
    const match = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : '';
}

function loadSettings(): VoiceSettings {
    const defaults: VoiceSettings = { autoSpeak: 'voice', voiceURI: '', rate: 1, lang: 'en-US' };
    try {
        return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') };
    } catch {
        return defaults;
    }
}

/** Speech should not read out markdown symbols. */
export function speakableText(text: string): string {
    return text
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/[#*_`>|]/g, '')
        .replace(/\[(.*?)\]\(.*?\)/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
}

export function useVoiceAssistant(options: {
    productId: Ref<number | null>;
    /** The PRD review selected for flow questions, sent with each message. */
    prdReviewId?: Ref<number | null>;
    onToolResult?: (name: string, data: unknown) => void;
}) {
    const state = ref<AssistantState>('IDLE');
    const level = ref(0);
    const messages = ref<ChatMessage[]>([]);
    const conversationId = ref<number | null>(null);
    const interim = ref('');
    const errorMessage = ref('');
    const connection = ref<ConnectionState>('connecting');
    const connectionMessage = ref('');
    const providerLabel = ref('');
    const settings = reactive<VoiceSettings>(loadSettings());
    const voices = ref<SpeechSynthesisVoice[]>([]);

    const Recognition = (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown }).SpeechRecognition ??
        (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    const speechInputSupported = Boolean(Recognition) && Boolean(navigator.mediaDevices?.getUserMedia);
    const speechOutputSupported = 'speechSynthesis' in window;

    let recognition: RecognitionInstance = null;
    let finalTranscript = '';
    let micStream: MediaStream | null = null;
    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let levelFrame = 0;
    let controller: AbortController | null = null;
    let interruptedByUser = false;

    watch(settings, (value) => {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(value));
        } catch {
            /* storage unavailable: settings just won't persist */
        }
    });

    if (speechOutputSupported) {
        const loadVoices = () => (voices.value = window.speechSynthesis.getVoices());
        loadVoices();
        window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    }

    /* ---------------- Connection status (honest) ---------------- */
    async function checkConnection() {
        connection.value = 'connecting';
        try {
            const response = await fetch('/assistant/status', { headers: { Accept: 'application/json' } });
            const body = await response.json();
            connection.value = (['connected', 'auth_required', 'error'].includes(body.state) ? body.state : 'error') as ConnectionState;
            connectionMessage.value = body.message ?? '';
            providerLabel.value = body.provider_label ?? '';
        } catch {
            connection.value = 'error';
            connectionMessage.value = 'The portal could not check the assistant connection.';
        }
    }

    /* ---------------- Microphone level (real audio) ---------------- */
    async function openMicrophone() {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        audioContext = new AudioContext();
        const node = audioContext.createAnalyser();
        node.fftSize = 512;
        node.smoothingTimeConstant = 0.75;
        audioContext.createMediaStreamSource(micStream).connect(node);
        analyser = node;
        const samples = new Uint8Array(node.fftSize);
        const tick = () => {
            node.getByteTimeDomainData(samples);
            let sum = 0;
            for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
            level.value = Math.min(1, Math.sqrt(sum / samples.length) * 5);
            levelFrame = requestAnimationFrame(tick);
        };
        tick();
    }

    /** Fills `out` with the live microphone spectrum (0–255 per band). False when the microphone is closed. */
    function readSpectrum(out: Uint8Array): boolean {
        if (!analyser) return false;
        analyser.getByteFrequencyData(out);
        return true;
    }

    function closeMicrophone() {
        cancelAnimationFrame(levelFrame);
        analyser = null;
        micStream?.getTracks().forEach((track) => track.stop());
        micStream = null;
        audioContext?.close().catch(() => undefined);
        audioContext = null;
        level.value = 0;
    }

    /* ---------------- Speech recognition ---------------- */
    async function startListening() {
        if (!speechInputSupported) return;
        if (['PROCESSING', 'ANALYZING', 'RESPONDING', 'SPEAKING'].includes(state.value)) interrupt(); // barge-in
        errorMessage.value = '';
        interim.value = '';
        finalTranscript = '';

        try {
            await openMicrophone();
        } catch {
            fail('Microphone access was blocked. Allow the microphone in the browser address bar, or type your question.');
            return;
        }

        recognition = new (Recognition as any)();
        recognition.lang = settings.lang;
        recognition.interimResults = true;
        recognition.continuous = false;
        recognition.maxAlternatives = 1;

        recognition.onstart = () => (state.value = 'LISTENING');
        recognition.onresult = (event: any) => {
            let draft = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) finalTranscript += transcript;
                else draft += transcript;
            }
            interim.value = (finalTranscript + draft).trim();
        };
        recognition.onerror = (event: any) => {
            const messagesByCode: Record<string, string> = {
                'not-allowed': 'Microphone access was blocked. Allow it in the browser, or type your question.',
                'service-not-allowed': 'Speech recognition is disabled in this browser.',
                network: 'The browser speech service could not be reached. Check the network, or type your question.',
                'audio-capture': 'No microphone was found.',
            };
            if (messagesByCode[event.error]) fail(messagesByCode[event.error]);
        };
        recognition.onend = () => {
            closeMicrophone();
            const text = finalTranscript.trim();
            interim.value = '';
            if (state.value !== 'LISTENING') return; // already failed or cancelled
            if (text) void send(text, true);
            else state.value = 'IDLE'; // nothing was said
        };
        recognition.start();
    }

    /** Stop listening and send what was heard. */
    function stopListening() {
        recognition?.stop();
    }

    /** Stop listening without sending anything (the user changed their mind). */
    function cancelListening() {
        if (state.value !== 'LISTENING') return;
        state.value = 'IDLE'; // set first, so the recogniser's end event does not send the transcript
        interim.value = '';
        finalTranscript = '';
        recognition?.abort?.();
        closeMicrophone();
    }

    /* ---------------- Streaming chat ---------------- */
    async function send(text: string, viaVoice = false) {
        const message = text.trim();
        if (!message) return;
        if (connection.value === 'auth_required') {
            fail(connectionMessage.value || 'No AI provider is connected yet.');
            return;
        }
        errorMessage.value = '';
        interruptedByUser = false;
        if (state.value === 'SPEAKING') window.speechSynthesis.cancel();

        messages.value.push({ id: crypto.randomUUID(), role: 'user', content: message, status: 'complete', tools: [] });
        const answer = reactive<ChatMessage>({ id: crypto.randomUUID(), role: 'assistant', content: '', status: 'streaming', tools: [] });
        messages.value.push(answer);
        state.value = 'PROCESSING';
        controller = new AbortController();

        try {
            const response = await fetch('/assistant/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'X-XSRF-TOKEN': csrfToken(), 'X-Requested-With': 'XMLHttpRequest' },
                body: JSON.stringify({ message, conversation_id: conversationId.value, product_id: options.productId.value, prd_review_id: options.prdReviewId?.value ?? null }),
                signal: controller.signal,
            });
            if (!response.ok || !response.body) {
                const reason = response.status === 429 ? 'You are sending messages too quickly. Wait a moment and try again.' : `The request failed (HTTP ${response.status}).`;
                throw new Error(reason);
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';
            let streamError: string | null = null;
            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                let boundary: number;
                while ((boundary = buffer.indexOf('\n\n')) !== -1) {
                    const raw = buffer.slice(0, boundary);
                    buffer = buffer.slice(boundary + 2);
                    const eventName = /^event: (\w+)/m.exec(raw)?.[1];
                    const dataLine = /^data: (.*)$/m.exec(raw)?.[1];
                    if (!eventName || !dataLine) continue;
                    const data = JSON.parse(dataLine);
                    switch (eventName) {
                        case 'conversation':
                            conversationId.value = data.id;
                            break;
                        case 'state':
                            state.value = data.state;
                            break;
                        case 'text':
                            if (state.value !== 'RESPONDING') state.value = 'RESPONDING';
                            answer.content += data.delta;
                            break;
                        case 'tool_result':
                            answer.tools.push({ name: data.name, ok: Boolean(data.ok) });
                            if (data.ok) options.onToolResult?.(data.name, data.data);
                            break;
                        case 'error':
                            streamError = data.message ?? 'Something went wrong.';
                            if (data.code === 'auth_required') {
                                connection.value = 'auth_required';
                                connectionMessage.value = data.message;
                            }
                            break;
                    }
                }
            }

            if (streamError) {
                answer.status = 'error';
                if (!answer.content) answer.content = streamError;
                fail(streamError);
                return;
            }
            answer.status = 'complete';
            const shouldSpeak = speechOutputSupported && (settings.autoSpeak === 'always' || (settings.autoSpeak === 'voice' && viaVoice));
            if (shouldSpeak && answer.content) speak(answer.content);
            else state.value = 'IDLE';
        } catch (error) {
            if (interruptedByUser) return; // interrupt() already set the state
            answer.status = 'error';
            fail(error instanceof Error ? error.message : 'Something went wrong.');
        } finally {
            controller = null;
        }
    }

    /* ---------------- Speech output ---------------- */
    let pulseFrame = 0;
    function pulseDecay() {
        level.value *= 0.9;
        if (state.value === 'SPEAKING' && level.value > 0.01) pulseFrame = requestAnimationFrame(pulseDecay);
    }

    function speak(text: string) {
        const synth = window.speechSynthesis;
        synth.cancel();
        // Chrome stops long utterances, so speak sentence by sentence.
        const parts = speakableText(text).match(/[^.!?]+[.!?]*/g) ?? [];
        const voice = voices.value.find((v) => v.voiceURI === settings.voiceURI) ?? null;
        parts.forEach((part, index) => {
            const utterance = new SpeechSynthesisUtterance(part.trim());
            utterance.lang = settings.lang;
            utterance.rate = settings.rate;
            if (voice) utterance.voice = voice;
            if (index === 0) utterance.onstart = () => (state.value = 'SPEAKING');
            utterance.onboundary = () => {
                level.value = 0.85;
                cancelAnimationFrame(pulseFrame);
                pulseFrame = requestAnimationFrame(pulseDecay);
            };
            if (index === parts.length - 1) {
                utterance.onend = () => {
                    if (state.value === 'SPEAKING') state.value = 'IDLE';
                    level.value = 0;
                };
            }
            utterance.onerror = (event) => {
                if (event.error !== 'interrupted' && event.error !== 'canceled') fail('The browser could not play the spoken answer.');
            };
            synth.speak(utterance);
        });
        if (!parts.length) state.value = 'IDLE';
    }

    /* ---------------- Interruption & errors ---------------- */
    function interrupt() {
        interruptedByUser = true;
        controller?.abort();
        recognition?.abort?.();
        closeMicrophone();
        if (speechOutputSupported) window.speechSynthesis.cancel();
        const last = messages.value[messages.value.length - 1];
        if (last?.status === 'streaming') last.status = 'interrupted';
        level.value = 0;
        state.value = 'INTERRUPTED';
    }

    function fail(message: string) {
        closeMicrophone();
        errorMessage.value = message;
        level.value = 0;
        state.value = 'ERROR';
    }

    /** Acknowledge an error or interruption (a user action, not a timer). */
    function reset() {
        errorMessage.value = '';
        if (state.value === 'ERROR' || state.value === 'INTERRUPTED') state.value = 'IDLE';
    }

    /* ---------------- History ---------------- */
    async function loadConversation(id: number) {
        if (state.value !== 'IDLE') interrupt();
        const response = await fetch(`/assistant/conversations/${id}`, { headers: { Accept: 'application/json' } });
        if (!response.ok) return fail('That conversation could not be loaded.');
        const body = await response.json();
        conversationId.value = body.id;
        messages.value = body.messages.map((m: { id: number; role: 'user' | 'assistant'; content: string; status: ChatMessage['status']; tools: ToolUse[] | null }) => ({
            id: String(m.id),
            role: m.role,
            content: m.content,
            status: m.status,
            tools: m.tools ?? [],
        }));
        state.value = 'IDLE';
        return body as { product_id: number | null };
    }

    function newConversation() {
        if (state.value !== 'IDLE') interrupt();
        conversationId.value = null;
        messages.value = [];
        reset();
        state.value = 'IDLE';
    }

    async function deleteConversation(id: number) {
        const response = await fetch(`/assistant/conversations/${id}`, {
            method: 'DELETE',
            headers: { Accept: 'application/json', 'X-XSRF-TOKEN': csrfToken(), 'X-Requested-With': 'XMLHttpRequest' },
        });
        if (conversationId.value === id) newConversation();
        return response.ok ? (await response.json()).conversations : null;
    }

    onBeforeUnmount(() => {
        controller?.abort();
        recognition?.abort?.();
        closeMicrophone();
        cancelAnimationFrame(pulseFrame);
        if (speechOutputSupported) window.speechSynthesis.cancel();
    });

    return {
        state, level, messages, conversationId, interim, errorMessage, connection, connectionMessage, providerLabel, settings, voices,
        speechInputSupported, speechOutputSupported,
        checkConnection, startListening, stopListening, cancelListening, readSpectrum, send, speak, interrupt, reset, loadConversation, newConversation, deleteConversation,
    };
}
