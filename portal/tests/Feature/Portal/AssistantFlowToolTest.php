<?php

namespace Tests\Feature\Portal;

use App\Enums\ConnectionType;
use App\Models\Connection;
use App\Models\PrdAnalysis;
use App\Models\PrdFlowRevision;
use App\Models\Product;
use App\Models\User;
use App\Services\Assistant\ContextToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/** The assistant's new tools (PRD flows, platform status, toolkit) and the PRD selected in the workspace. */
class AssistantFlowToolTest extends TestCase
{
    use RefreshDatabase;

    private User $member;

    private User $admin;

    private Product $crm;

    private Product $billing;

    private PrdAnalysis $review;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'releaseguard.services.assistant.url' => 'http://assistant.test',
            'releaseguard.services.assistant.token' => 'assistant-token',
            'releaseguard.toolkit.path' => AssistantLiveTest::makeToolkit(),
        ]);
        $this->member = User::factory()->create();
        $this->admin = User::factory()->admin()->create();
        $this->crm = Product::create(['name' => 'CRM', 'slug' => 'crm']);
        $this->billing = Product::create(['name' => 'Billing', 'slug' => 'billing']);
        $this->crm->users()->attach($this->member);
        $this->review = PrdFlowTest::reviewWithFlows($this->admin, ['product_id' => $this->crm->id]);
    }

    private function callTool(User $user, string $tool, array $input = [])
    {
        return $this->withHeaders(['Authorization' => 'Bearer assistant-token', 'X-Assistant-Context' => ContextToken::issue($user, null)])
            ->postJson("/internal/assistant/tools/{$tool}", ['input' => $input]);
    }

    private function crmUser(): User
    {
        $user = User::factory()->create();
        $user->forceFill(['crm_user_id' => 9862])->save();

        return $user;
    }

    /* ---------------- get_prd_flow ---------------- */

    public function test_a_flow_is_found_by_id_or_part_of_its_name(): void
    {
        $this->callTool($this->member, 'get_prd_flow', ['review_id' => $this->review->id, 'flow' => 'flow-owner-01'])
            ->assertOk()
            ->assertJsonPath('found', true)
            ->assertJsonPath('flow.name', 'Invite an agent')
            ->assertJsonPath('flow.graph.lanes', ['Agency owner', 'System'])
            ->assertJsonPath('graph_source', 'ai')
            ->assertJsonPath('version', 0);

        $this->callTool($this->member, 'get_prd_flow', ['review_id' => $this->review->id, 'flow' => 'accept'])
            ->assertJsonPath('found', true)
            ->assertJsonPath('flow.id', 'FLOW-AGENT-01')
            ->assertJsonPath('graph_source', 'steps');
    }

    public function test_without_a_clear_match_the_flows_to_choose_from_are_returned(): void
    {
        $this->callTool($this->member, 'get_prd_flow', ['review_id' => $this->review->id, 'flow' => 'an'])
            ->assertJsonPath('found', false)
            ->assertJsonPath('flows.0.id', 'FLOW-OWNER-01')
            ->assertJsonPath('flows.1.id', 'FLOW-AGENT-01');
        $this->callTool($this->member, 'get_prd_flow', ['review_id' => $this->review->id])->assertJsonCount(2, 'flows');
    }

    public function test_the_latest_corrected_version_is_returned(): void
    {
        PrdFlowRevision::create(['prd_analysis_id' => $this->review->id, 'flow_id' => 'FLOW-OWNER-01', 'version' => 1, 'change_summary' => 'Renamed',
            'flow' => ['id' => 'FLOW-OWNER-01', 'actor' => 'Agency owner', 'name' => 'Invite by email', 'steps' => [], 'graph' => PrdFlowTest::GRAPH]]);

        $this->callTool($this->member, 'get_prd_flow', ['review_id' => $this->review->id, 'flow' => 'FLOW-OWNER-01'])
            ->assertJsonPath('flow.name', 'Invite by email')
            ->assertJsonPath('version', 1);
    }

    public function test_flows_of_reviews_outside_the_persons_products_are_not_visible(): void
    {
        $other = PrdFlowTest::reviewWithFlows($this->admin, ['product_id' => $this->billing->id]);

        $this->callTool($this->member, 'get_prd_flow', ['review_id' => $other->id, 'flow' => 'FLOW-OWNER-01'])->assertJsonPath('found', false)->assertJsonMissingPath('flow');
        $this->callTool($this->admin, 'get_prd_flow', ['review_id' => $other->id, 'flow' => 'FLOW-OWNER-01'])->assertJsonPath('found', true);
        $this->callTool($this->member, 'get_prd_flow', ['review_id' => 0])->assertStatus(422);
    }

    public function test_review_details_list_the_flows(): void
    {
        $this->callTool($this->member, 'get_prd_review_details', ['review_id' => $this->review->id])
            ->assertJsonPath('flows', [
                ['id' => 'FLOW-OWNER-01', 'name' => 'Invite an agent', 'actor' => 'Agency owner'],
                ['id' => 'FLOW-AGENT-01', 'name' => 'Accept an invite', 'actor' => 'Agent'],
            ]);
    }

    /* ---------------- Platform and toolkit ---------------- */

    public function test_platform_status_reports_services_and_only_admins_see_connections(): void
    {
        Http::fake([
            '*/health' => Http::response(['status' => 'ok']),
            '*/manifest' => Http::response(['version' => '1.2.0']),
        ]);
        Connection::create(['type' => ConnectionType::Gemini, 'settings' => ['api_key' => 'AIza-test-123456789', 'model' => '']]);

        $this->callTool($this->admin, 'get_platform_status')
            ->assertOk()
            ->assertJsonPath('online', 4)
            ->assertJsonPath('services.0.version', '1.2.0')
            ->assertJsonPath('ai_provider.configured', true)
            ->assertJsonPath('connections.0.type', 'ai');
        $this->callTool($this->member, 'get_platform_status')->assertJsonPath('connections', null);
    }

    public function test_toolkit_inventory_lists_what_the_toolkit_installs(): void
    {
        $this->callTool($this->member, 'get_toolkit_inventory')
            ->assertOk()
            ->assertJsonPath('available', true)
            ->assertJsonPath('rules', ['core', 'security'])
            ->assertJsonPath('skills', ['planner'])
            ->assertJsonPath('agents', ['code-reviewer'])
            ->assertJsonPath('hooks', ['guard-bash'])
            ->assertJsonPath('docs.0.title', 'Claude Code onboarding');
    }

    public function test_crm_users_cannot_use_the_engineering_tools(): void
    {
        $crm = $this->crmUser();

        foreach (['get_prd_flow' => ['review_id' => $this->review->id], 'get_platform_status' => [], 'get_toolkit_inventory' => []] as $tool => $input) {
            $this->callTool($crm, $tool, $input)->assertOk()->assertJsonPath('authorised', false);
        }
    }

    /* ---------------- PRD selected in the workspace ---------------- */

    public function test_the_selected_prd_is_sent_to_the_assistant(): void
    {
        Connection::create(['type' => ConnectionType::Anthropic, 'settings' => ['auth_method' => 'api_key', 'api_key' => 'sk-ant-test-123456789', 'model' => '']]);
        Http::fake(['http://assistant.test/v1/chat' => Http::response("event: done\ndata: {}\n\n", 200, ['Content-Type' => 'text/event-stream'])]);

        $this->actingAs($this->member)->post('/assistant/chat', ['message' => 'Show the invite flow', 'prd_review_id' => $this->review->id])->assertOk()->streamedContent();

        Http::assertSent(fn (Request $request) => $request['prd_review'] === ['id' => $this->review->id, 'title' => 'Agent invites']);
    }

    public function test_a_prd_the_person_cannot_see_is_refused(): void
    {
        $other = PrdFlowTest::reviewWithFlows($this->admin, ['product_id' => $this->billing->id]);
        Http::fake();

        $this->actingAs($this->member)->postJson('/assistant/chat', ['message' => 'Hi', 'prd_review_id' => $other->id])->assertForbidden();
        $this->actingAs($this->crmUser())->postJson('/assistant/chat', ['message' => 'Hi', 'prd_review_id' => $this->review->id])->assertForbidden();
        Http::assertNothingSent();
    }

    public function test_the_prd_picker_lists_completed_reviews_in_scope(): void
    {
        PrdFlowTest::reviewWithFlows($this->admin, ['product_id' => $this->billing->id, 'title' => 'Billing PRD']);
        PrdAnalysis::create(['user_id' => $this->admin->id, 'product_id' => $this->crm->id, 'title' => 'Queued', 'source_type' => 'text', 'status' => 'queued']);

        $this->actingAs($this->member)->getJson('/assistant/prd-reviews')
            ->assertOk()
            ->assertJsonCount(1, 'reviews')
            ->assertJsonPath('reviews.0', ['id' => $this->review->id, 'title' => 'Agent invites', 'score' => 80, 'product' => 'CRM', 'flows' => 2]);
        $this->actingAs($this->admin)->getJson('/assistant/prd-reviews')->assertJsonCount(2, 'reviews');
        $this->actingAs($this->crmUser())->getJson('/assistant/prd-reviews')->assertForbidden();
    }
}
