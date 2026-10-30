<?php

namespace Tests\Feature\Portal;

use App\Enums\ConnectionType;
use App\Models\Connection;
use App\Models\User;
use App\Services\Assistant\ContextToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class CrmPerformanceTest extends TestCase
{
    use RefreshDatabase;

    private const OWNER = ['crm_user_id' => 9862, 'name' => 'Mustafa', 'email' => 'owner@agency.test', 'persona' => 'agency_owner', 'level' => 'agency', 'agency_id' => 1, 'agency_name' => 'Zain Avenue'];

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'releaseguard.services.performance.url' => 'http://performance.test',
            'releaseguard.services.performance.token' => 'performance-token',
            'releaseguard.services.assistant.token' => 'assistant-token',
        ]);
    }

    private function connectCrm(): void
    {
        Connection::create(['type' => ConnectionType::CrmDatabase, 'settings' => [
            'host' => 'host.docker.internal', 'port' => '3306', 'database' => 'homenet', 'username' => 'releaseguard_ro', 'password' => 'ro-secret', 'table_prefix' => 'crm_',
        ]]);
    }

    private function overview(string $level = 'agency', bool $demo = false): array
    {
        return [
            'demo' => $demo, 'scope' => ['level' => $level, 'label' => 'Zain Avenue'], 'period' => ['key' => '30d'],
            'currency' => ['primary' => 'RM', 'mixed' => false], 'kpis' => ['won_revenue' => ['value' => 1200, 'change_pct' => 10.0, 'previous' => 1090]],
            'earnings' => ['paid' => 50, 'approved' => 20, 'pending_review' => 5, 'monthly' => []], 'leaderboard' => [['user_id' => 343, 'name' => 'Syafiq Faddir', 'agency' => 'Zain Avenue', 'revenue' => 1200, 'deals' => 1, 'leads' => 5, 'won' => 1, 'lost' => 1, 'win_rate' => 50, 'commission' => 50, 'listings' => 3]],
            'directory' => ['agents' => [['user_id' => 343, 'name' => 'Syafiq Faddir']]], 'agencies' => [], 'sources' => [], 'lost_reasons' => [], 'definitions' => [],
        ];
    }

    /* ---------------- Sign-in with a CRM account ---------------- */

    public function test_crm_account_signs_in_and_is_linked_without_storing_the_password(): void
    {
        $this->connectCrm();
        Http::fake(['http://performance.test/v1/identity/verify' => Http::response(['identity' => self::OWNER])]);

        $this->post('/login', ['email' => 'owner@agency.test', 'password' => 'crm-password'])->assertRedirect('/assistant');

        $user = User::sole();
        $this->assertAuthenticatedAs($user);
        $this->assertSame([9862, 'agency_owner', 1, 'Zain Avenue', 'member'], [$user->crm_user_id, $user->crm_persona, $user->crm_agency_id, $user->crm_agency_name, $user->role]);
        $this->assertNotNull($user->email_verified_at);
        $this->assertFalse(password_verify('crm-password', $user->password));
        Http::assertSent(fn (Request $request) => $request->hasHeader('Authorization', 'Bearer performance-token')
            && $request['credentials']['crm_db']['username'] === 'releaseguard_ro'
            && $request['password'] === 'crm-password');
    }

    public function test_unknown_crm_credentials_fail_like_any_wrong_password(): void
    {
        $this->connectCrm();
        Http::fake(['http://performance.test/*' => Http::response(['detail' => 'These credentials do not match our records.'], 401)]);

        $this->post('/login', ['email' => 'someone@agency.test', 'password' => 'nope'])->assertSessionHasErrors(['email' => trans('auth.failed')]);
        $this->assertGuest();
    }

    public function test_known_but_blocked_crm_accounts_see_the_reason(): void
    {
        $this->connectCrm();
        Http::fake(['http://performance.test/*' => Http::response(['detail' => 'Your agent account is not active.'], 403)]);

        $this->post('/login', ['email' => 'agent@agency.test', 'password' => 'right'])->assertSessionHasErrors(['email' => 'Your agent account is not active.']);
        $this->assertGuest();
    }

    public function test_crm_is_not_called_when_it_is_not_connected_or_the_local_account_matches(): void
    {
        Http::fake();
        User::factory()->create(['email' => 'admin', 'password' => '123456']);

        $this->post('/login', ['email' => 'admin', 'password' => '123456'])->assertRedirect('/assistant');
        $this->post('/logout');
        $this->post('/login', ['email' => 'owner@agency.test', 'password' => 'x'])->assertSessionHasErrors('email');
        Http::assertNothingSent();
    }

    public function test_crm_linked_users_cannot_sign_in_with_a_local_password(): void
    {
        $this->connectCrm();
        $user = User::factory()->create(['email' => 'owner@agency.test', 'password' => 'local-reset-password']);
        $user->forceFill(['crm_user_id' => 9862])->save();
        Http::fake(['http://performance.test/*' => Http::response(['detail' => 'Your agent account is not active.'], 403)]);

        $this->post('/login', ['email' => 'owner@agency.test', 'password' => 'local-reset-password'])->assertSessionHasErrors('email');
        $this->assertGuest(); // the CRM decides, and it said no
    }

    public function test_a_crm_account_never_takes_over_a_releaseguard_account_with_the_same_email(): void
    {
        $this->connectCrm();
        User::factory()->create(['email' => 'owner@agency.test']);
        Http::fake(['http://performance.test/*' => Http::response(['identity' => self::OWNER])]);

        $this->post('/login', ['email' => 'owner@agency.test', 'password' => 'crm-password'])->assertSessionHasErrors('email');
        $this->assertGuest();
        $this->assertNull(User::sole()->crm_user_id);
    }

    /* ---------------- Who sees what ---------------- */

    public function test_performance_is_for_executives_and_crm_users_only(): void
    {
        $member = User::factory()->create();
        $admin = User::factory()->admin()->create();
        $crm = User::factory()->create();
        $crm->forceFill(['crm_user_id' => 9862, 'crm_persona' => 'agency_owner'])->save();

        $this->actingAs($member)->get('/performance')->assertForbidden();
        $this->actingAs($admin)->get('/performance')->assertOk()->assertInertia(fn ($page) => $page->component('performance/Index')->where('viewer.kind', 'executive'));
        $this->actingAs($crm)->get('/performance')->assertOk()->assertInertia(fn ($page) => $page->where('viewer.persona', 'agency_owner'));
    }

    public function test_crm_users_cannot_open_engineering_tools(): void
    {
        $crm = User::factory()->create();
        $crm->forceFill(['crm_user_id' => 5])->save();

        foreach (['/dashboard', '/prd', '/monitoring'] as $url) {
            $this->actingAs($crm)->get($url)->assertForbidden();
        }
        $this->actingAs($crm)->get('/assistant')->assertOk();
    }

    public function test_the_viewer_is_decided_on_the_server_not_by_the_browser(): void
    {
        $this->connectCrm();
        $crm = User::factory()->create();
        $crm->forceFill(['crm_user_id' => 9862])->save();
        Http::fake(['http://performance.test/v1/performance/overview' => Http::response($this->overview())]);

        $this->actingAs($crm)->getJson('/performance/data?period=90d&agent_user_id=343&viewer[kind]=executive')->assertOk()->assertJsonPath('scope.level', 'agency');

        Http::assertSent(fn (Request $request) => $request['viewer'] === ['kind' => 'crm', 'crm_user_id' => 9862]
            && $request['period'] === '90d' && $request['agent_user_id'] === 343
            && $request['credentials']['crm_db']['password'] === 'ro-secret');
    }

    public function test_scope_refusals_from_the_service_are_returned_as_403(): void
    {
        $this->connectCrm();
        $crm = User::factory()->create();
        $crm->forceFill(['crm_user_id' => 9862])->save();
        Http::fake(['http://performance.test/*' => Http::response(['detail' => 'That agent is not in your agency.'], 403)]);

        $this->actingAs($crm)->getJson('/performance/data?agent_user_id=1')->assertForbidden()->assertJsonPath('message', 'That agent is not in your agency.');
        $this->actingAs($crm)->getJson('/performance/data?period=forever')->assertUnprocessable();
    }

    /* ---------------- Assistant tool ---------------- */

    private function callTool(User $user, string $tool, array $input = [])
    {
        return $this->withHeaders(['Authorization' => 'Bearer assistant-token', 'X-Assistant-Context' => ContextToken::issue($user, null)])
            ->postJson("/internal/assistant/tools/{$tool}", ['input' => $input]);
    }

    public function test_sales_performance_tool_is_scoped_to_the_asking_person(): void
    {
        $this->connectCrm();
        $crm = User::factory()->create();
        $crm->forceFill(['crm_user_id' => 9862])->save();
        Http::fake(['http://performance.test/*' => Http::response($this->overview())]);

        $result = $this->callTool($crm, 'get_sales_performance', ['period' => '30d', 'agent_name' => 'syafiq'])->assertOk();

        $result->assertJsonPath('top_agents.0.name', 'Syafiq Faddir')->assertJsonPath('kpis.won_revenue.value', 1200);
        $this->assertArrayNotHasKey('previous', $result->json('kpis.won_revenue'));
        Http::assertSentCount(2); // overview, then the named agent
        Http::assertSent(fn (Request $request) => $request['viewer'] === ['kind' => 'crm', 'crm_user_id' => 9862] && ($request['agent_user_id'] ?? null) === 343);
    }

    public function test_crm_users_only_get_sales_tools_and_members_get_no_sales_data(): void
    {
        $crm = User::factory()->create();
        $crm->forceFill(['crm_user_id' => 9862])->save();
        $member = User::factory()->create();

        $this->callTool($crm, 'get_prd_reviews')->assertOk()->assertJsonPath('authorised', false);
        $this->callTool($crm, 'get_monitoring_status')->assertOk()->assertJsonPath('authorised', false);
        $this->callTool($member, 'get_sales_performance')->assertOk()->assertJsonPath('authorised', false);
        $this->callTool($crm, 'get_sales_performance', ['period' => 'forever'])->assertStatus(422);
    }

    /* ---------------- Connection ---------------- */

    public function test_crm_database_connection_is_validated_and_tested_by_the_performance_service(): void
    {
        $admin = User::factory()->admin()->create();
        $this->actingAs($admin)->put('/connections/crm_db', ['host' => 'bad host;', 'database' => 'x y', 'username' => 'ro', 'password' => 'p', 'table_prefix' => 'crm_; drop'])
            ->assertSessionHasErrors(['host', 'database', 'table_prefix']);

        $this->actingAs($admin)->put('/connections/crm_db', ['host' => 'host.docker.internal', 'port' => '3306', 'database' => 'homenet', 'username' => 'releaseguard_ro', 'password' => 'ro-secret', 'table_prefix' => 'crm_'])
            ->assertSessionHasNoErrors();
        Http::fake(['http://performance.test/v1/connections/test' => Http::response(['ok' => true, 'message' => 'Connected to the CRM database: 470 leads.'])]);

        $this->actingAs($admin)->post('/connections/crm_db/test')->assertSessionHas('success', 'Connected to the CRM database: 470 leads.');
        Http::assertSent(fn (Request $request) => $request['connection'] === 'crm_db' && array_keys($request['credentials']) === ['crm_db']);
    }
}
