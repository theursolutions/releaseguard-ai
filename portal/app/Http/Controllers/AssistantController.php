<?php

namespace App\Http\Controllers;

use App\Models\AssistantConversation;
use App\Models\PrdAnalysis;
use App\Models\Product;
use App\Services\Assistant\BusinessTools;
use App\Services\Assistant\ContextToken;
use App\Services\Assistant\LiveSummary;
use App\Services\Platform\AiProviderResolver;
use App\Services\Platform\CredentialBroker;
use App\Services\Platform\ServiceClient;
use App\Services\Platform\ServiceException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

class AssistantController extends Controller
{
    public function index(Request $request): Response
    {
        $user = $request->user();

        return Inertia::render('assistant/Index', [
            'products' => $user->authorizedProducts()->map->only(['id', 'name', 'description'])->values(),
            'conversations' => $this->conversationList($request),
            'isAdmin' => $user->isAdmin(),
            // PRD flows and the engineering widgets are not for people signed in with a CRM account.
            'canUseFlows' => ! $user->isCrmUser(),
            'refreshSeconds' => 15,
        ]);
    }

    /**
     * Honest connection state for the status indicator: connected, auth_required or error.
     * The assistant service checks the provider; nothing is assumed from the saved settings alone.
     */
    public function status(ServiceClient $services, CredentialBroker $broker, AiProviderResolver $ai): JsonResponse
    {
        $credentials = $broker->forService('assistant');
        if (! isset($credentials['llm'])) {
            return response()->json(['state' => 'auth_required', 'message' => $ai->missingMessage()]);
        }

        $key = 'assistant.status.'.hash('sha256', json_encode($credentials));
        $status = Cache::get($key);
        if (! $status) {
            try {
                $status = $services->post('assistant', '/v1/status', ['credentials' => $credentials]);
            } catch (ServiceException $e) {
                return response()->json(['state' => 'error', 'message' => $e->getMessage()]);
            }
            if (($status['state'] ?? null) === 'connected') {
                Cache::put($key, $status, now()->addSeconds(config('releaseguard.assistant.status_cache_seconds')));
            }
        }

        return response()->json($status);
    }

    /** Real data for the command-centre widgets, fetched directly (no AI involved). */
    public function live(Request $request, LiveSummary $live): JsonResponse
    {
        // ?sections=performance or ?sections=monitoring,prd,... ; unknown names are ignored.
        $only = $request->filled('sections')
            ? array_values(array_intersect(explode(',', (string) $request->query('sections')), LiveSummary::SECTIONS))
            : null;

        return response()->json($live->for($request->user(), $this->authorizedProduct($request), $only));
    }

    /** Completed PRD reviews the person can pick for flow questions, in the selected product's scope. */
    public function prdReviews(Request $request, BusinessTools $tools): JsonResponse
    {
        $reviews = $tools->reviewQuery($request->user(), $this->authorizedProduct($request))
            ->where('status', PrdAnalysis::STATUS_COMPLETED)
            ->with('product:id,name')->latest()->limit(30)
            ->get(['id', 'title', 'score', 'product_id', 'result', 'created_at']);

        return response()->json(['reviews' => $reviews->map(fn (PrdAnalysis $r) => [
            'id' => $r->id,
            'title' => $r->title,
            'score' => $r->score,
            'product' => $r->product?->name,
            'flows' => count($r->result['flows'] ?? []),
        ])->values()]);
    }

    public function conversation(Request $request, AssistantConversation $conversation): JsonResponse
    {
        abort_unless($conversation->user_id === $request->user()->id, 404);

        return response()->json([
            'id' => $conversation->id,
            'product_id' => $conversation->product_id,
            'messages' => $conversation->messages()->orderBy('id')->get(['id', 'role', 'content', 'status', 'tools', 'created_at']),
        ]);
    }

    public function destroyConversation(Request $request, AssistantConversation $conversation): JsonResponse
    {
        abort_unless($conversation->user_id === $request->user()->id, 404);
        $conversation->delete();

        return response()->json(['deleted' => true, 'conversations' => $this->conversationList($request)]);
    }

    /**
     * Streams the answer as Server-Sent Events, proxying the assistant service. The conversation is
     * saved as it happens, including partial answers when the user interrupts.
     */
    public function chat(Request $request, CredentialBroker $broker, BusinessTools $tools): StreamedResponse|JsonResponse
    {
        $data = $request->validate([
            'message' => ['required', 'string', 'min:1', 'max:4000'],
            'conversation_id' => ['nullable', 'integer'],
            'product_id' => ['nullable', 'integer'],
            'prd_review_id' => ['nullable', 'integer'],
        ]);
        $user = $request->user();
        $product = $this->authorizedProduct($request);

        // The selected PRD must be one this person may see in this scope; the tools check it again.
        $review = null;
        if (isset($data['prd_review_id'])) {
            $review = $user->isCrmUser() ? null : $tools->reviewQuery($user, $product)->where('status', PrdAnalysis::STATUS_COMPLETED)->find($data['prd_review_id']);
            abort_unless($review, 403, 'You do not have access to this PRD review.');
        }

        $conversation = isset($data['conversation_id'])
            ? AssistantConversation::query()->where('user_id', $user->id)->findOrFail($data['conversation_id'])
            : AssistantConversation::create(['user_id' => $user->id, 'product_id' => $product?->id, 'title' => Str::limit(trim($data['message']), 80)]);

        $history = $conversation->messages()
            ->where('status', 'complete')->where('content', '!=', '')
            ->latest('id')->limit(config('releaseguard.assistant.history_messages'))->get(['role', 'content'])
            ->reverse()->values()->map->only(['role', 'content'])->all();

        $conversation->messages()->create(['role' => 'user', 'content' => $data['message']]);
        $conversation->touch();

        $payload = [
            'message' => $data['message'],
            'history' => $history,
            'user_name' => Str::of($user->name)->before(' ')->toString(),
            'product' => $product?->name,
            'prd_review' => $review ? ['id' => $review->id, 'title' => $review->title] : null,
            'context_token' => ContextToken::issue($user, $product),
            'credentials' => $broker->forService('assistant') ?: new \stdClass,
        ];

        return response()->stream(function () use ($payload, $conversation) {
            $this->relay($payload, $conversation);
        }, 200, [
            'Content-Type' => 'text/event-stream',
            'Cache-Control' => 'no-cache, no-transform',
            'X-Accel-Buffering' => 'no',
        ]);
    }

    /** @param array<string, mixed> $payload */
    private function relay(array $payload, AssistantConversation $conversation): void
    {
        // Keep running after a browser disconnect just long enough to save the partial answer.
        ignore_user_abort(true);

        $this->send('conversation', ['id' => $conversation->id, 'title' => $conversation->title]);

        $text = '';
        $tools = [];
        $status = 'complete';
        $model = null;
        $config = config('releaseguard.services.assistant');

        try {
            $response = Http::withToken((string) $config['token'])
                ->withOptions(['stream' => true])
                ->accept('text/event-stream')
                ->connectTimeout(5)
                ->timeout($config['timeout'])
                ->post(rtrim($config['url'], '/').'/v1/chat', $payload);
        } catch (ConnectionException) {
            $this->send('error', ['code' => 'service_unavailable', 'message' => 'The assistant service is not reachable. Check that it is running.']);
            $this->save($conversation, 'The assistant service was not reachable.', [], 'error', null);

            return;
        }

        if ($response->failed()) {
            Log::warning('Assistant service error', ['status' => $response->status()]);
            $this->send('error', ['code' => 'service_error', 'message' => "The assistant service returned an error (HTTP {$response->status()})."]);
            $this->save($conversation, '', [], 'error', null);

            return;
        }

        $body = $response->toPsrResponse()->getBody();
        $buffer = '';
        while (! $body->eof()) {
            $chunk = $body->read(4096);
            if ($chunk === '') {
                continue;
            }
            echo $chunk;
            $this->flush();
            if (connection_aborted()) {
                $status = 'interrupted';
                break;
            }

            // Follow the events to save the answer: text, tools used, model, errors.
            $buffer .= $chunk;
            while (($end = strpos($buffer, "\n\n")) !== false) {
                $raw = substr($buffer, 0, $end);
                $buffer = substr($buffer, $end + 2);
                if (! preg_match('/^event: (\w+)\ndata: (.*)$/s', $raw, $m)) {
                    continue;
                }
                $event = json_decode($m[2], true) ?? [];
                match ($m[1]) {
                    'text' => $text .= (string) ($event['delta'] ?? ''),
                    'tool_result' => $tools[] = ['name' => $event['name'] ?? '?', 'ok' => (bool) ($event['ok'] ?? false)],
                    'done' => $model = $event['model'] ?? null,
                    'error' => [$status, $text] = ['error', $text !== '' ? $text : (string) ($event['message'] ?? 'Error')],
                    default => null,
                };
            }
        }

        // Closing the upstream stream cancels generation in the assistant service.
        $body->close();
        $this->save($conversation, $text, $tools, $status, $model);
    }

    /** @param array<int, array<string, mixed>> $tools */
    private function save(AssistantConversation $conversation, string $text, array $tools, string $status, ?string $model): void
    {
        $conversation->messages()->create([
            'role' => 'assistant',
            'content' => $text,
            'tools' => $tools ?: null,
            'status' => $status,
            'model' => $model,
        ]);
        $conversation->touch();
    }

    /** @param array<string, mixed> $data */
    private function send(string $event, array $data): void
    {
        echo "event: {$event}\ndata: ".json_encode($data)."\n\n";
        $this->flush();
    }

    /** Push output to the browser immediately, through any output buffer (as Laravel's eventStream does). */
    private function flush(): void
    {
        if (ob_get_level() > 0) {
            ob_flush();
        }
        flush();
    }

    private function authorizedProduct(Request $request): ?Product
    {
        $id = $request->integer('product_id') ?: null;
        if (! $id) {
            return null;
        }
        $product = Product::query()->find($id);
        abort_unless($product && $request->user()->canAccessProduct($product), 403, 'You do not have access to this product.');

        return $product;
    }

    private function conversationList(Request $request)
    {
        return AssistantConversation::query()
            ->where('user_id', $request->user()->id)
            ->latest('updated_at')->limit(30)
            ->get(['id', 'title', 'product_id', 'updated_at']);
    }
}
