<?php

namespace Tests\Feature\Portal;

use App\Enums\ConnectionType;
use App\Models\AssistantConversation;
use App\Models\Connection;
use App\Models\PrdAnalysis;
use App\Models\Product;
use App\Models\User;
use App\Services\Assistant\ContextToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class AssistantTest extends TestCase
{
    use RefreshDatabase;

    private User $member;

    private User $admin;

    private Product $crm;

    private Product $billing;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'releaseguard.services.assistant.url' => 'http://assistant.test',
            'releaseguard.services.assistant.token' => 'assistant-token',
            'releaseguard.services.monitoring.url' => 'http://monitoring.test',
            'releaseguard.services.monitoring.token' => 'monitoring-token',
        ]);
        $this->member = User::factory()->create(['name' => 'Mia Member']);
        $this->admin = User::factory()->admin()->create();
        $this->crm = Product::create(['name' => 'CRM', 'slug' => 'crm', 'alarm_prefix' => 'production-crm-']);
        $this->billing = Product::create(['name' => 'Billing', 'slug' => 'billing', 'alarm_prefix' => 'production-billing-']);
        $this->crm->users()->attach($this->member);
    }

    private function connectClaude(): void
    {
        Connection::create(['type' => ConnectionType::Anthropic, 'settings' => ['auth_method' => 'api_key', 'api_key' => 'sk-ant-test-123456789', 'model' => '']]);
    }

    private function callTool(string $tool, ?string $context, array $input = [], string $token = 'assistant-token')
    {
        return $this->withHeaders(['Authorization' => "Bearer {$token}", 'X-Assistant-Context' => (string) $context])
            ->postJson("/internal/assistant/tools/{$tool}", ['input' => $input]);
    }

    private function fakeMonitoring(): void
    {
        Http::fake(['http://monitoring.test/v1/overview' => Http::response([
            'demo' => true,
            'alarms' => [
                ['name' => 'production-crm-api-5xx', 'state' => 'ALARM', 'severity' => 'critical'],
                ['name' => 'production-billing-queue-depth', 'state' => 'ALARM', 'severity' => 'warning'],
                ['name' => 'production-crm-db-cpu', 'state' => 'OK', 'severity' => 'warning'],
            ],
            'forecasts' => [],
        ])]);
    }

    /* ---------------- Context token ---------------- */

    public function test_context_token_round_trips_user_and_product(): void
    {
        $context = ContextToken::verify(ContextToken::issue($this->member, $this->crm));

        $this->assertTrue($context['user']->is($this->member));
        $this->assertTrue($context['product']->is($this->crm));
    }

    public function test_tampered_expired_or_revoked_context_is_rejected(): void
    {
        $token = ContextToken::issue($this->member, $this->crm);
        [$payload, $signature] = explode('.', $token);
        $forged = rtrim(strtr(base64_encode(json_encode(['u' => $this->admin->id, 'p' => null, 'e' => now()->addHour()->timestamp])), '+/', '-_'), '=');

        $this->assertNull(ContextToken::verify("{$forged}.{$signature}"));
        $this->assertNull(ContextToken::verify('garbage'));
        $this->assertNull(ContextToken::verify(null));

        $this->travel(16)->minutes();
        $this->assertNull(ContextToken::verify($token));
        $this->travelBack();

        $fresh = ContextToken::issue($this->member, $this->crm);
        $this->crm->users()->detach($this->member);
        $this->assertNull(ContextToken::verify($fresh), 'Revoked product access must stop the token working immediately.');
    }

    /* ---------------- Internal tool endpoint ---------------- */

    public function test_tool_endpoint_requires_service_token_and_valid_context(): void
    {
        $context = ContextToken::issue($this->member, null);

        $this->callTool('get_prd_reviews', $context, [], 'wrong-token')->assertStatus(401);
        $this->callTool('get_prd_reviews', 'bad.context')->assertStatus(403);
        $this->callTool('delete_everything', $context)->assertStatus(404);
        $this->callTool('get_prd_reviews', $context, ['limit' => 500])->assertStatus(422);
        $this->callTool('get_prd_reviews', $context, ['limit' => 5])->assertOk()->assertJsonPath('reviews', []);
    }

    public function test_tool_endpoint_is_closed_when_no_service_token_is_configured(): void
    {
        config(['releaseguard.services.assistant.token' => '']);

        $this->callTool('get_prd_reviews', ContextToken::issue($this->member, null), [], '')->assertStatus(401);
    }

    public function test_members_only_see_reviews_for_their_products(): void
    {
        PrdAnalysis::create(['user_id' => $this->admin->id, 'product_id' => $this->crm->id, 'source_type' => 'text', 'title' => 'CRM PRD', 'status' => 'completed', 'score' => 80]);
        PrdAnalysis::create(['user_id' => $this->admin->id, 'product_id' => $this->billing->id, 'source_type' => 'text', 'title' => 'Billing PRD', 'status' => 'completed', 'score' => 50]);
        PrdAnalysis::create(['user_id' => $this->admin->id, 'source_type' => 'text', 'title' => 'Unassigned PRD', 'status' => 'completed', 'score' => 60]);

        $titles = fn ($response) => collect($response->json('reviews'))->pluck('title')->sort()->values()->all();

        $this->assertSame(['CRM PRD', 'Unassigned PRD'], $titles($this->callTool('get_prd_reviews', ContextToken::issue($this->member, null))));
        $this->assertSame(['CRM PRD'], $titles($this->callTool('get_prd_reviews', ContextToken::issue($this->member, $this->crm))));
        $this->assertSame(['Billing PRD', 'CRM PRD', 'Unassigned PRD'], $titles($this->callTool('get_prd_reviews', ContextToken::issue($this->admin, null))));

        $billingId = PrdAnalysis::where('title', 'Billing PRD')->value('id');
        $this->callTool('get_prd_review_details', ContextToken::issue($this->member, null), ['review_id' => $billingId])->assertOk()->assertJsonPath('found', false);
    }

    public function test_team_activity_is_admin_only(): void
    {
        $this->callTool('get_team_activity', ContextToken::issue($this->member, null))->assertOk()->assertJsonPath('authorised', false);
        $this->callTool('get_team_activity', ContextToken::issue($this->admin, null))->assertOk()->assertJsonPath('authorised', true);
    }

    public function test_monitoring_tool_is_scoped_by_product_alarm_prefix_and_labels_demo_data(): void
    {
        $this->fakeMonitoring();

        $response = $this->callTool('get_monitoring_status', ContextToken::issue($this->member, $this->crm))->assertOk();

        $this->assertSame(['production-crm-api-5xx', 'production-crm-db-cpu'], collect($response->json('alarms'))->pluck('name')->all());
        $response->assertJsonPath('counts.ALARM', 1)->assertJsonPath('demo_data', true);
        $this->assertStringContainsString('simulated demo alarms', $response->json('note'));
    }

    /* ---------------- Status ---------------- */

    public function test_status_reports_auth_required_without_calling_the_service(): void
    {
        Http::fake();

        $this->actingAs($this->member)->getJson('/assistant/status')->assertOk()->assertJsonPath('state', 'auth_required');
        Http::assertNothingSent();
    }

    public function test_status_asks_the_service_when_claude_is_connected(): void
    {
        $this->connectClaude();
        Http::fake(['http://assistant.test/v1/status' => Http::response(['state' => 'connected', 'message' => 'Claude is connected.', 'provider' => 'anthropic'])]);

        $this->actingAs($this->member)->getJson('/assistant/status')->assertOk()->assertJsonPath('state', 'connected');
        $this->actingAs($this->member)->getJson('/assistant/status')->assertOk();
        Http::assertSentCount(1); // the connected state is cached briefly
    }

    public function test_connections_saved_before_the_method_choice_are_sent_as_api_keys(): void
    {
        Connection::create(['type' => ConnectionType::Anthropic, 'settings' => ['api_key' => 'sk-ant-legacy-123456789', 'model' => '']]);
        Http::fake(['http://assistant.test/v1/status' => Http::response(['state' => 'connected', 'message' => 'ok', 'provider' => 'anthropic'])]);

        $this->actingAs($this->member)->getJson('/assistant/status')->assertJsonPath('state', 'connected');

        Http::assertSent(fn (Request $request) => $request['credentials']['llm']['provider'] === 'anthropic'
            && $request['credentials']['llm']['auth_method'] === 'api_key');
    }

    public function test_automatic_uses_the_first_provider_that_is_set_up(): void
    {
        Connection::create(['type' => ConnectionType::Gemini, 'settings' => ['api_key' => 'AIzaSyTestKey1234567890', 'model' => '']]);
        Http::fake(['http://assistant.test/v1/status' => Http::response(['state' => 'connected', 'message' => 'ok', 'provider' => 'gemini', 'provider_label' => 'Gemini'])]);

        $this->actingAs($this->member)->getJson('/assistant/status')->assertJsonPath('provider_label', 'Gemini');

        Http::assertSent(fn (Request $request) => $request['credentials']['llm']['provider'] === 'gemini');
    }

    public function test_an_explicit_choice_is_used_and_never_silently_swapped(): void
    {
        $this->connectClaude();
        Connection::create(['type' => ConnectionType::OpenAi, 'settings' => ['api_key' => 'sk-openai-test-123456', 'model' => '']]);
        Connection::create(['type' => ConnectionType::AiProvider, 'settings' => ['provider' => 'openai']]);
        Http::fake(['http://assistant.test/v1/status' => Http::response(['state' => 'connected', 'message' => 'ok', 'provider' => 'openai'])]);

        $this->actingAs($this->member)->getJson('/assistant/status')->assertJsonPath('state', 'connected');
        Http::assertSent(fn (Request $request) => $request['credentials']['llm']['provider'] === 'openai');

        // Gemini chosen but not set up: honest auth_required, no fallback to Claude or OpenAI.
        Connection::for(ConnectionType::AiProvider)->update(['settings' => ['provider' => 'gemini']]);
        $this->actingAs($this->member)->getJson('/assistant/status')
            ->assertJsonPath('state', 'auth_required')
            ->assertJsonPath('message', 'Gemini is selected as the AI provider but is not set up. An admin must add its key on the Connections page, or choose another provider.');
    }

    /* ---------------- Workspace & product access ---------------- */

    public function test_workspace_lists_only_authorised_products(): void
    {
        $this->actingAs($this->member)->get('/assistant')->assertOk()
            ->assertInertia(fn ($page) => $page->component('assistant/Index')->has('products', 1)->where('products.0.name', 'CRM'));
        $this->actingAs($this->admin)->get('/assistant')->assertOk()
            ->assertInertia(fn ($page) => $page->has('products', 2));
    }

    public function test_other_products_are_refused(): void
    {
        $this->fakeMonitoring();

        $this->actingAs($this->member)->getJson("/assistant/live?product_id={$this->billing->id}")->assertForbidden();
        $this->actingAs($this->member)->postJson('/assistant/chat', ['message' => 'Hi', 'product_id' => $this->billing->id])->assertForbidden();
        $this->actingAs($this->member)->getJson("/assistant/live?product_id={$this->crm->id}")->assertOk()->assertJsonPath('sections.activity.team', null);
        $this->actingAs($this->admin)->getJson('/assistant/live')->assertOk()->assertJsonPath('sections.activity.team.authorised', true);
    }

    /* ---------------- Chat relay ---------------- */

    public function test_chat_streams_the_answer_and_saves_the_conversation(): void
    {
        $this->connectClaude();
        $stream = implode('', [
            "event: state\ndata: {\"state\":\"ANALYZING\"}\n\n",
            "event: tool_result\ndata: {\"name\":\"get_prd_reviews\",\"ok\":true,\"data\":{}}\n\n",
            "event: text\ndata: {\"delta\":\"Two PRDs \"}\n\n",
            "event: text\ndata: {\"delta\":\"are ready.\"}\n\n",
            "event: done\ndata: {\"stop_reason\":\"end_turn\",\"model\":\"claude-opus-5-5\"}\n\n",
        ]);
        Http::fake(['http://assistant.test/v1/chat' => Http::response($stream, 200, ['Content-Type' => 'text/event-stream'])]);

        $response = $this->actingAs($this->member)->post('/assistant/chat', ['message' => 'Which PRDs are ready?', 'product_id' => $this->crm->id]);
        $response->assertOk();
        $body = $response->streamedContent();

        $conversation = AssistantConversation::sole();
        $this->assertStringStartsWith("event: conversation\ndata: {\"id\":{$conversation->id}", $body);
        $this->assertStringContainsString('are ready.', $body);
        $this->assertSame($this->crm->id, $conversation->product_id);

        [$question, $answer] = $conversation->messages()->orderBy('id')->get()->all();
        $this->assertSame(['user', 'Which PRDs are ready?'], [$question->role, $question->content]);
        $this->assertSame(['assistant', 'Two PRDs are ready.', 'complete', 'claude-opus-5-5'], [$answer->role, $answer->content, $answer->status, $answer->model]);
        $this->assertSame([['name' => 'get_prd_reviews', 'ok' => true]], $answer->tools);

        Http::assertSent(function (Request $request) {
            $context = ContextToken::verify($request['context_token']);

            return $request->hasHeader('Authorization', 'Bearer assistant-token')
                && $request['credentials']['llm'] === ['provider' => 'anthropic', 'auth_method' => 'api_key', 'model' => null, 'api_key' => 'sk-ant-test-123456789']
                && $request['product'] === 'CRM'
                && $request['user_name'] === 'Mia'
                && $context['user']->is($this->member)
                && $context['product']->is($this->crm);
        });
    }

    public function test_follow_up_sends_previous_complete_messages_as_history(): void
    {
        $this->connectClaude();
        $conversation = AssistantConversation::create(['user_id' => $this->member->id, 'title' => 'Earlier']);
        $conversation->messages()->create(['role' => 'user', 'content' => 'First question']);
        $conversation->messages()->create(['role' => 'assistant', 'content' => 'First answer', 'status' => 'complete']);
        $conversation->messages()->create(['role' => 'assistant', 'content' => 'Half an ans', 'status' => 'interrupted']);
        Http::fake(['http://assistant.test/v1/chat' => Http::response("event: done\ndata: {}\n\n")]);

        $this->actingAs($this->member)->post('/assistant/chat', ['message' => 'Follow up', 'conversation_id' => $conversation->id])->streamedContent();

        Http::assertSent(fn (Request $request) => $request['history'] === [
            ['role' => 'user', 'content' => 'First question'],
            ['role' => 'assistant', 'content' => 'First answer'],
        ]);
    }

    public function test_a_long_conversation_keeps_at_least_its_last_ten_messages_as_context(): void
    {
        $this->connectClaude();
        $conversation = AssistantConversation::create(['user_id' => $this->member->id, 'title' => 'Long']);
        foreach (range(1, 15) as $i) {
            $conversation->messages()->create(['role' => 'user', 'content' => "Question {$i}"]);
            $conversation->messages()->create(['role' => 'assistant', 'content' => "Answer {$i}", 'status' => 'complete']);
        }
        Http::fake(['http://assistant.test/v1/chat' => Http::response("event: done\ndata: {}\n\n")]);

        $this->actingAs($this->member)->post('/assistant/chat', ['message' => 'And the one before?', 'conversation_id' => $conversation->id])->streamedContent();

        Http::assertSent(function (Request $request) {
            $history = $request['history'];

            return count($history) >= 10
                && end($history) === ['role' => 'assistant', 'content' => 'Answer 15'] // oldest first, newest last
                && $history[count($history) - 10] === ['role' => 'user', 'content' => 'Question 11'];
        });
    }

    public function test_service_errors_are_streamed_and_saved_honestly(): void
    {
        Http::fake(['http://assistant.test/v1/chat' => Http::response("event: error\ndata: {\"code\":\"auth_required\",\"message\":\"Claude is not connected.\"}\n\n")]);

        $body = $this->actingAs($this->member)->post('/assistant/chat', ['message' => 'Hello'])->streamedContent();

        $this->assertStringContainsString('auth_required', $body);
        $answer = AssistantConversation::sole()->messages()->where('role', 'assistant')->sole();
        $this->assertSame(['error', 'Claude is not connected.'], [$answer->status, $answer->content]);
    }

    public function test_conversations_are_private_to_their_owner(): void
    {
        $conversation = AssistantConversation::create(['user_id' => $this->admin->id, 'title' => 'Admin only']);

        $this->actingAs($this->member)->getJson("/assistant/conversations/{$conversation->id}")->assertNotFound();
        $this->actingAs($this->member)->deleteJson("/assistant/conversations/{$conversation->id}")->assertNotFound();
        $this->actingAs($this->member)->postJson('/assistant/chat', ['message' => 'Hi', 'conversation_id' => $conversation->id])->assertNotFound();
        $this->actingAs($this->admin)->deleteJson("/assistant/conversations/{$conversation->id}")->assertOk()->assertJsonPath('conversations', []);
    }

    public function test_messages_are_validated(): void
    {
        $this->actingAs($this->member)->postJson('/assistant/chat', ['message' => ''])->assertUnprocessable();
        $this->actingAs($this->member)->postJson('/assistant/chat', ['message' => str_repeat('a', 4001)])->assertUnprocessable();
    }

    public function test_guests_cannot_use_the_assistant(): void
    {
        $this->get('/assistant')->assertRedirect('/login');
        $this->postJson('/assistant/chat', ['message' => 'Hi'])->assertUnauthorized();
    }
}
