<?php

namespace Tests\Feature\Portal;

use App\Enums\ConnectionType;
use App\Models\Connection;
use App\Models\PrdAnalysis;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/** The command-centre widgets around the voice assistant (/assistant/live). */
class AssistantLiveTest extends TestCase
{
    use RefreshDatabase;

    /** A small toolkit folder with the same layout as Module A. */
    public static function makeToolkit(): string
    {
        $root = sys_get_temp_dir().'/rg-toolkit-'.uniqid();
        $files = [
            'plugin/rules/core.md' => '# Core',
            'plugin/rules/security.md' => '# Security',
            'plugin/skills/planner/SKILL.md' => '---',
            'plugin/agents/code-reviewer.md' => '---',
            'plugin/hooks/guard-bash.js' => '//',
            'plugin/.mcp.json' => '{}',
            'plugin/.claude-plugin/plugin.json' => '{"name": "devcrew"}',
            'docs/ONBOARDING.md' => "Intro\n# Claude Code onboarding\n",
        ];
        foreach ($files as $path => $content) {
            @mkdir(dirname("{$root}/{$path}"), 0777, true);
            file_put_contents("{$root}/{$path}", $content);
        }

        return $root;
    }

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'releaseguard.services.monitoring.url' => 'http://monitoring.test',
            'releaseguard.services.monitoring.token' => 'monitoring-token',
            'releaseguard.services.performance.url' => 'http://performance.test',
            'releaseguard.services.performance.token' => 'performance-token',
            'releaseguard.toolkit.path' => self::makeToolkit(),
        ]);
    }

    private function fakeServices(int $performanceStatus = 200): void
    {
        Http::fake([
            'http://monitoring.test/v1/overview' => Http::response([
                'demo' => true,
                'generated_at' => '2026-10-27T08:00:00+00:00',
                'alarms' => [
                    ['name' => 'production-crm-db-cpu', 'state' => 'OK', 'severity' => 'warning', 'series' => [1, 2]],
                    ['name' => 'production-crm-api-5xx', 'state' => 'ALARM', 'severity' => 'critical', 'updated_at' => '2026-10-27T07:00:00+00:00', 'series' => range(1, 30)],
                ],
                'forecasts' => [['resource' => 'rds:crm', 'label' => 'Database crm', 'days' => 3]],
            ]),
            'http://performance.test/v1/performance/overview' => $performanceStatus === 200
                ? Http::response([
                    'demo' => false, 'scope' => ['label' => 'All agencies'], 'currency' => ['primary' => 'RM', 'mixed' => true],
                    'kpis' => ['won_revenue' => ['value' => 1200, 'change_pct' => 10.0]], 'revenue_trend' => [['won' => 5], ['won' => 7]],
                    'leaderboard' => [['user_id' => 1, 'name' => 'Aisha', 'revenue' => 1200, 'deals' => 1, 'win_rate' => 50]],
                    'earnings' => ['paid' => 50, 'approved' => 20, 'pending_review' => 5],
                ])
                : Http::response(['detail' => 'The CRM database is not reachable.'], $performanceStatus),
            '*/health' => Http::response(['status' => 'ok']),
            '*/manifest' => Http::response(['version' => '1.0.0']),
        ]);
    }

    public function test_admins_get_every_section_from_real_data(): void
    {
        $this->fakeServices();
        $admin = User::factory()->admin()->create();
        PrdAnalysis::create(['user_id' => $admin->id, 'title' => 'Agent invites', 'source_type' => 'text', 'status' => 'completed', 'score' => 82, 'result' => []]);

        $response = $this->actingAs($admin)->getJson('/assistant/live')->assertOk();

        $this->assertSame(['performance', 'monitoring', 'platform', 'toolkit', 'prd', 'activity'], array_keys($response->json('sections')));
        $response
            ->assertJsonPath('sections.performance.kpis.won_revenue.value', 1200)
            ->assertJsonPath('sections.performance.currency_mixed', true)
            ->assertJsonPath('sections.performance.trend', [5, 7])
            ->assertJsonPath('sections.monitoring.demo_data', true)
            ->assertJsonPath('sections.monitoring.counts.critical', 1)
            ->assertJsonPath('sections.monitoring.alarms.0.name', 'production-crm-api-5xx') // firing alarms first
            ->assertJsonCount(24, 'sections.monitoring.alarms.0.series')
            ->assertJsonPath('sections.monitoring.forecasts.0.days', 3)
            ->assertJsonPath('sections.platform.online', 4)
            ->assertJsonPath('sections.toolkit.skills', ['planner'])
            ->assertJsonPath('sections.prd.reviewed', 1)
            ->assertJsonPath('sections.prd.ready_for_sprint', 1)
            ->assertJsonPath('sections.prd.recent.0.title', 'Agent invites')
            ->assertJsonPath('sections.activity.team.authorised', true);
        $this->assertIsArray($response->json('sections.platform.connections'));
    }

    public function test_the_ticker_shows_real_events_and_labels_demo_alarms(): void
    {
        $this->fakeServices();
        $admin = User::factory()->admin()->create();
        PrdAnalysis::create(['user_id' => $admin->id, 'title' => 'Agent invites', 'source_type' => 'text', 'status' => 'completed', 'score' => 55, 'result' => []]);
        PrdAnalysis::create(['user_id' => $admin->id, 'title' => 'Still running', 'source_type' => 'text', 'status' => 'running']);

        $events = collect($this->actingAs($admin)->getJson('/assistant/live')->json('sections.activity.events'));

        $this->assertSame(['alarm', 'prd'], $events->pluck('kind')->sort()->values()->all());
        $this->assertTrue($events->firstWhere('kind', 'alarm')['demo']);
        $prd = $events->firstWhere('kind', 'prd');
        $this->assertSame(['PRD "Agent invites" scored 55', 'warn', false], [$prd['label'], $prd['tone'], $prd['demo']]);
    }

    public function test_members_get_no_team_connections_or_sales(): void
    {
        $this->fakeServices();

        $response = $this->actingAs(User::factory()->create())->getJson('/assistant/live')->assertOk();

        $response->assertJsonPath('sections.performance', null)
            ->assertJsonPath('sections.platform.connections', null)
            ->assertJsonPath('sections.activity.team', null)
            ->assertJsonPath('sections.toolkit.available', true);
    }

    public function test_crm_users_only_get_their_sales_performance(): void
    {
        $this->fakeServices();
        Connection::create(['type' => ConnectionType::CrmDatabase, 'settings' => ['host' => 'db', 'port' => '3306', 'database' => 'homenet', 'username' => 'ro', 'password' => 'x', 'table_prefix' => 'crm_']]);
        $crm = User::factory()->create();
        $crm->forceFill(['crm_user_id' => 9862])->save();

        $response = $this->actingAs($crm)->getJson('/assistant/live')->assertOk();

        $this->assertSame(['performance'], array_keys($response->json('sections')));
        $response->assertJsonPath('sections.performance.scope', 'All agencies');
    }

    public function test_a_failing_source_shows_its_own_error_while_the_others_load(): void
    {
        $this->fakeServices(performanceStatus: 502);

        $response = $this->actingAs(User::factory()->admin()->create())->getJson('/assistant/live')->assertOk();

        $response->assertJsonPath('sections.performance.error', 'The CRM database is not reachable.')
            ->assertJsonPath('sections.monitoring.available', true)
            ->assertJsonPath('sections.toolkit.available', true);
    }

    public function test_a_missing_toolkit_folder_is_reported_not_hidden(): void
    {
        $this->fakeServices();
        config(['releaseguard.toolkit.path' => sys_get_temp_dir().'/rg-no-toolkit-'.uniqid()]);

        $this->actingAs(User::factory()->create())->getJson('/assistant/live')
            ->assertJsonPath('sections.toolkit.available', false)
            ->assertJsonPath('sections.toolkit.note', fn (string $note) => str_contains($note, 'TOOLKIT_PATH'));
    }

    public function test_guests_cannot_read_the_widgets(): void
    {
        $this->getJson('/assistant/live')->assertUnauthorized();
    }

    public function test_the_page_can_ask_for_some_sections_so_slow_sales_never_hold_up_the_others(): void
    {
        $this->fakeServices();
        $admin = User::factory()->admin()->create();

        $engineering = $this->actingAs($admin)->getJson('/assistant/live?sections=monitoring,platform,toolkit,prd,activity')->assertOk();
        $this->assertSame(['monitoring', 'platform', 'toolkit', 'prd', 'activity'], array_keys($engineering->json('sections')));
        Http::assertNotSent(fn (Request $request) => str_contains($request->url(), '/v1/performance/overview')); // no CRM query

        $sales = $this->actingAs($admin)->getJson('/assistant/live?sections=performance,nonsense')->assertOk();
        $this->assertSame(['performance'], array_keys($sales->json('sections')));
        $sales->assertJsonPath('sections.performance.kpis.won_revenue.value', 1200);
    }

    public function test_while_another_request_runs_the_crm_query_the_sales_widget_waits_then_says_so(): void
    {
        $this->fakeServices();
        config(['releaseguard.assistant.live.performance_timeout_seconds' => 1]);
        $admin = User::factory()->admin()->create();
        $key = "live.performance.{$admin->id}.".md5(json_encode($admin->performanceViewer()));
        $running = Cache::lock("{$key}.lock", 10);
        $running->get();

        $this->actingAs($admin)->getJson('/assistant/live?sections=performance')
            ->assertOk()
            ->assertJsonPath('sections.performance.error', 'The CRM figures are still being calculated. They appear on the next refresh.');
        Http::assertNotSent(fn (Request $request) => str_contains($request->url(), '/v1/performance/overview'));

        $running->release();
        $this->actingAs($admin)->getJson('/assistant/live?sections=performance')->assertJsonPath('sections.performance.kpis.won_revenue.value', 1200);
    }

    public function test_asking_for_sections_never_widens_what_a_person_may_see(): void
    {
        $this->fakeServices();
        $crm = User::factory()->create();
        $crm->forceFill(['crm_user_id' => 9862])->save();

        $this->actingAs($crm)->getJson('/assistant/live?sections=monitoring,platform,toolkit')->assertOk()->assertJsonPath('sections', []);
        $this->actingAs(User::factory()->create())->getJson('/assistant/live?sections=performance')->assertJsonPath('sections.performance', null);
    }
}
