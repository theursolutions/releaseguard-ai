<?php

namespace Tests\Feature\Portal;

use App\Enums\ConnectionType;
use App\Models\Connection;
use App\Models\PrdAnalysis;
use App\Models\PrdFlowRevision;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class PrdFlowTest extends TestCase
{
    use RefreshDatabase;

    public const GRAPH = [
        'lanes' => ['Agency owner', 'System'],
        'nodes' => [
            ['id' => 's', 'lane' => 'Agency owner', 'kind' => 'start', 'label' => 'Open invites'],
            ['id' => 'd', 'lane' => 'System', 'kind' => 'decision', 'label' => 'Email valid?'],
            ['id' => 'e', 'lane' => 'System', 'kind' => 'end', 'label' => 'Invite sent'],
        ],
        'edges' => [['from' => 's', 'to' => 'd', 'label' => ''], ['from' => 'd', 'to' => 'e', 'label' => 'Yes']],
    ];

    private User $author;

    private User $colleague;

    private User $admin;

    private PrdAnalysis $review;

    protected function setUp(): void
    {
        parent::setUp();
        config(['releaseguard.services.prd.url' => 'http://prd.test', 'releaseguard.services.prd.token' => 'prd-token']);
        $this->author = User::factory()->create();
        $this->colleague = User::factory()->create();
        $this->admin = User::factory()->admin()->create();
        $this->review = self::reviewWithFlows($this->author);
    }

    public static function reviewWithFlows(User $author, array $attributes = []): PrdAnalysis
    {
        return PrdAnalysis::create($attributes + [
            'user_id' => $author->id, 'title' => 'Agent invites', 'source_type' => 'text', 'status' => 'completed', 'score' => 80,
            'result' => ['summary' => 'Invites', 'flows' => [
                ['id' => 'FLOW-OWNER-01', 'actor' => 'Agency owner', 'name' => 'Invite an agent', 'steps' => ['Open invites', 'Send'], 'acceptance_criteria' => [], 'graph' => self::GRAPH],
                ['id' => 'FLOW-AGENT-01', 'actor' => 'Agent', 'name' => 'Accept an invite', 'steps' => ['Open email', 'Click link', 'Join agency'], 'acceptance_criteria' => []],
            ]],
        ]);
    }

    private function connectAi(): void
    {
        Connection::create(['type' => ConnectionType::Anthropic, 'settings' => ['auth_method' => 'api_key', 'api_key' => 'sk-ant-test-123456789', 'model' => '']]);
        Connection::create(['type' => ConnectionType::Atlassian, 'settings' => ['site_url' => 'https://acme.atlassian.net', 'email' => 'a@acme.test', 'api_token' => 'atl-secret']]);
    }

    private function fakeRevision(string $name = 'Invite an agent by email', string $summary = 'Renamed the flow.'): void
    {
        Http::fake(['http://prd.test/v1/flows/revise' => Http::response([
            'flow' => ['id' => 'IGNORED', 'actor' => 'Agency owner', 'name' => $name, 'steps' => ['Open invites'], 'graph' => self::GRAPH],
            'change_summary' => $summary,
            'model' => 'claude-opus-5-5',
        ])]);
    }

    private function flowUrl(string $flow = 'FLOW-OWNER-01', string $suffix = ''): string
    {
        return "/prd/{$this->review->id}/flows/{$flow}{$suffix}";
    }

    /* ---------------- Reading ---------------- */

    public function test_flows_are_listed_with_their_swimlanes(): void
    {
        $this->actingAs($this->colleague)->getJson("/prd/{$this->review->id}/flows")
            ->assertOk()
            ->assertJsonPath('review.title', 'Agent invites')
            ->assertJsonPath('flows.0.lanes', ['Agency owner', 'System'])
            ->assertJsonPath('flows.0.version', 0)
            ->assertJsonPath('flows.1.lanes', ['Agent']);
    }

    public function test_the_review_page_draws_every_flow_at_its_latest_version(): void
    {
        PrdFlowRevision::create([
            'prd_analysis_id' => $this->review->id, 'flow_id' => 'FLOW-OWNER-01', 'version' => 1, 'user_id' => $this->author->id,
            'flow' => ['id' => 'FLOW-OWNER-01', 'module' => 'Team invites', 'actor' => 'Agency owner', 'name' => 'Invite by email', 'graph' => self::GRAPH],
            'instruction' => 'Rename it', 'change_summary' => 'Renamed.',
        ]);

        $this->actingAs($this->colleague)->get("/prd/{$this->review->id}")->assertInertia(fn ($page) => $page
            ->component('prd/Show')
            ->has('flows', 2)
            ->where('flows.0.name', 'Invite by email') // the correction, not the original
            ->where('flows.0.module', 'Team invites')
            ->where('flows.0.version', 1)
            ->where('flows.0.graph.lanes', ['Agency owner', 'System'])
            ->where('flows.1.graph_source', 'steps') // no AI graph: drawn from its steps
            ->where('flows.1.graph.nodes.2.kind', 'end'));
    }

    public function test_a_review_still_running_has_no_flows_to_draw(): void
    {
        $running = self::reviewWithFlows($this->author, ['status' => 'running']);

        $this->actingAs($this->colleague)->get("/prd/{$running->id}")->assertInertia(fn ($page) => $page->where('flows', []));
    }

    public function test_a_flow_is_returned_with_its_graph_and_who_may_correct_it(): void
    {
        $this->actingAs($this->colleague)->getJson($this->flowUrl())
            ->assertOk()
            ->assertJsonPath('graph_source', 'ai')
            ->assertJsonPath('flow.graph.edges.1.label', 'Yes')
            ->assertJsonPath('versions.0.version', 0)
            ->assertJsonPath('can_correct', false);
        $this->actingAs($this->author)->getJson($this->flowUrl())->assertJsonPath('can_correct', true);
        $this->actingAs($this->admin)->getJson($this->flowUrl())->assertJsonPath('can_correct', true);
    }

    public function test_reviews_made_before_graphs_existed_get_one_lane_built_from_the_steps(): void
    {
        $response = $this->actingAs($this->author)->getJson($this->flowUrl('FLOW-AGENT-01'))->assertOk();

        $response->assertJsonPath('graph_source', 'steps')->assertJsonPath('flow.graph.lanes', ['Agent']);
        $this->assertSame(['start', 'action', 'end'], array_column($response->json('flow.graph.nodes'), 'kind'));
        $this->assertSame([['from' => 'step0', 'to' => 'step1', 'label' => ''], ['from' => 'step1', 'to' => 'step2', 'label' => '']], $response->json('flow.graph.edges'));
    }

    public function test_unknown_flows_and_unfinished_reviews_are_not_found(): void
    {
        $this->actingAs($this->author)->getJson($this->flowUrl('FLOW-NOPE-99'))->assertNotFound();
        $queued = PrdAnalysis::create(['user_id' => $this->author->id, 'title' => 'Draft', 'source_type' => 'text', 'status' => 'queued']);
        $this->actingAs($this->author)->getJson("/prd/{$queued->id}/flows")->assertNotFound();
    }

    public function test_crm_users_and_guests_cannot_open_flows(): void
    {
        $crm = User::factory()->create();
        $crm->forceFill(['crm_user_id' => 9862])->save();

        $this->actingAs($crm)->getJson($this->flowUrl())->assertForbidden();
        $this->actingAs($crm)->postJson($this->flowUrl(suffix: '/corrections'), ['instruction' => 'Add a step'])->assertForbidden();
        auth()->logout();
        $this->getJson($this->flowUrl())->assertUnauthorized();
    }

    /* ---------------- Corrections ---------------- */

    public function test_a_correction_is_saved_as_a_new_version_and_the_original_is_kept(): void
    {
        $this->connectAi();
        $this->fakeRevision();

        $this->actingAs($this->author)->postJson($this->flowUrl(suffix: '/corrections'), ['instruction' => 'Call it invite by email'])
            ->assertOk()
            ->assertJsonPath('version', 1)
            ->assertJsonPath('flow.id', 'FLOW-OWNER-01')
            ->assertJsonPath('flow.name', 'Invite an agent by email')
            ->assertJsonPath('versions.1.change_summary', 'Renamed the flow.')
            ->assertJsonPath('versions.1.instruction', 'Call it invite by email');

        $this->assertSame('Invite an agent', $this->review->fresh()->result['flows'][0]['name']);
        $this->assertSame([1, $this->author->id, 'claude-opus-5-5'], [PrdFlowRevision::sole()->version, PrdFlowRevision::sole()->user_id, PrdFlowRevision::sole()->model]);

        Http::assertSent(fn (Request $request) => $request->url() === 'http://prd.test/v1/flows/revise'
            && $request->hasHeader('Authorization', 'Bearer prd-token')
            && $request['instruction'] === 'Call it invite by email'
            && $request['prd_title'] === 'Agent invites'
            && $request['flow']['id'] === 'FLOW-OWNER-01'
            && $request['flow']['graph']['lanes'] === ['Agency owner', 'System']
            && isset($request['credentials']['llm'])
            && ! isset($request['credentials']['atlassian'])); // only the AI provider is needed
    }

    public function test_corrections_and_restores_add_versions_without_rewriting_history(): void
    {
        $this->connectAi();
        $this->fakeRevision();
        $this->actingAs($this->author)->postJson($this->flowUrl(suffix: '/corrections'), ['instruction' => 'Rename it'])->assertJsonPath('version', 1);
        $this->actingAs($this->admin)->postJson($this->flowUrl(suffix: '/corrections'), ['instruction' => 'Rename it again'])->assertJsonPath('version', 2);

        $this->actingAs($this->author)->postJson($this->flowUrl(suffix: '/restore/0'))
            ->assertOk()
            ->assertJsonPath('version', 3)
            ->assertJsonPath('flow.name', 'Invite an agent')
            ->assertJsonPath('versions.3.restored_from_version', 0)
            ->assertJsonPath('versions.3.change_summary', 'Restored version 0.');

        $this->assertSame([1, 2, 3], PrdFlowRevision::query()->orderBy('version')->pluck('version')->all());
        $this->actingAs($this->author)->getJson("/prd/{$this->review->id}/flows")->assertJsonPath('flows.0.version', 3);
    }

    public function test_only_the_author_or_an_admin_can_correct_or_restore(): void
    {
        $this->connectAi();
        $this->fakeRevision();

        $this->actingAs($this->colleague)->postJson($this->flowUrl(suffix: '/corrections'), ['instruction' => 'Add a step'])->assertForbidden();
        $this->actingAs($this->colleague)->postJson($this->flowUrl(suffix: '/restore/0'))->assertForbidden();
        $this->assertSame(0, PrdFlowRevision::count());
        Http::assertNothingSent();
    }

    public function test_corrections_are_validated(): void
    {
        foreach ([[], ['instruction' => 'ab'], ['instruction' => str_repeat('x', 1001)]] as $body) {
            $this->actingAs($this->author)->postJson($this->flowUrl(suffix: '/corrections'), $body)->assertUnprocessable()->assertJsonValidationErrors('instruction');
        }
        $this->actingAs($this->author)->postJson($this->flowUrl('FLOW-NOPE-99', '/corrections'), ['instruction' => 'Add a step'])->assertNotFound();
        $this->actingAs($this->author)->postJson($this->flowUrl(suffix: '/restore/7'))->assertNotFound();
    }

    public function test_without_an_ai_provider_nothing_is_sent_and_the_next_step_is_given(): void
    {
        Http::fake();

        $this->actingAs($this->author)->postJson($this->flowUrl(suffix: '/corrections'), ['instruction' => 'Add a step'])
            ->assertUnprocessable()
            ->assertJsonPath('message', fn (string $message) => str_contains($message, 'No AI provider is connected'));
        Http::assertNothingSent();
    }

    public function test_a_failed_revision_saves_nothing_and_shows_the_service_message(): void
    {
        $this->connectAi();
        Http::fake(['http://prd.test/v1/flows/revise' => Http::response(['detail' => 'The AI returned a flow that does not connect. Nothing was saved.'], 502)]);

        $this->actingAs($this->author)->postJson($this->flowUrl(suffix: '/corrections'), ['instruction' => 'Add a step'])
            ->assertStatus(502)
            ->assertJsonPath('message', 'The AI returned a flow that does not connect. Nothing was saved.');
        $this->assertSame(0, PrdFlowRevision::count());
    }

    public function test_deleting_a_review_deletes_its_flow_versions(): void
    {
        PrdFlowRevision::create(['prd_analysis_id' => $this->review->id, 'flow_id' => 'FLOW-OWNER-01', 'version' => 1, 'flow' => ['id' => 'FLOW-OWNER-01'], 'change_summary' => 'x']);

        $this->review->delete();

        $this->assertSame(0, PrdFlowRevision::count());
    }
}
