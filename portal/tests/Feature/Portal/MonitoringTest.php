<?php

namespace Tests\Feature\Portal;

use App\Enums\ConnectionType;
use App\Jobs\RunAlarmDiagnosis;
use App\Models\AlarmDiagnosis;
use App\Models\Connection;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class MonitoringTest extends TestCase
{
    use RefreshDatabase;

    private User $member;

    protected function setUp(): void
    {
        parent::setUp();
        $this->member = User::factory()->create();
        config(['releaseguard.services.monitoring.url' => 'http://monitoring.test', 'releaseguard.services.monitoring.token' => 'monitoring-token']);

        Connection::create(['type' => ConnectionType::Aws, 'settings' => ['region' => 'ap-southeast-1', 'access_key_id' => 'AKIAABCDEFGHIJKLMNOP', 'secret_access_key' => 'secretsecretsecret', 'alarm_prefix' => 'production-', 'log_group_prefix' => '/releaseguard/production/']]);
        Connection::create(['type' => ConnectionType::Anthropic, 'settings' => ['auth_method' => 'api_key', 'api_key' => 'sk-ant-test-123456789', 'model' => '']]);
        Connection::create(['type' => ConnectionType::Slack, 'settings' => ['webhook_url' => 'https://hooks.slack.com/services/x']]);
    }

    public function test_overview_is_loaded_with_only_aws_credentials(): void
    {
        Http::fake(['http://monitoring.test/v1/overview' => Http::response([
            'demo' => false,
            'alarms' => [['name' => 'production-rds-db-cpu-warning', 'state' => 'ALARM', 'severity' => 'warning']],
            'forecasts' => [],
            'counts' => ['ALARM' => 1, 'OK' => 0, 'INSUFFICIENT_DATA' => 0, 'critical' => 0],
        ])]);

        $this->actingAs($this->member)->get('/monitoring')
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component('monitoring/Index')->where('overview.data.counts.ALARM', 1)->where('overview.error', null));

        Http::assertSent(fn (Request $request) => $request->hasHeader('Authorization', 'Bearer monitoring-token')
            && array_keys($request['credentials']) === ['aws']
            && $request['credentials']['aws']['alarm_prefix'] === 'production-');
    }

    public function test_service_outage_shows_a_message_instead_of_crashing(): void
    {
        Http::fake(fn () => throw new ConnectionException('refused'));

        $this->actingAs($this->member)->get('/monitoring')
            ->assertOk()
            ->assertInertia(fn ($page) => $page->where('overview.data', null)->where('overview.error', 'The Monitoring service is not reachable. Check that it is running.'));
    }

    public function test_without_connections_credentials_are_sent_as_an_empty_object(): void
    {
        Connection::query()->delete();
        Http::fake(['*' => Http::response(['demo' => true, 'alarms' => [], 'forecasts' => [], 'counts' => []])]);

        $this->actingAs($this->member)->get('/monitoring')->assertOk();

        // Regression: an empty PHP array became a JSON list ([]) and the service rejected it with 422.
        Http::assertSent(fn (Request $request) => str_contains($request->body(), '"credentials":{}'));
    }

    public function test_diagnosis_is_queued_then_saved_with_aws_and_claude_only(): void
    {
        Http::fake(['http://monitoring.test/v1/alarms/diagnose' => Http::response([
            'demo' => false, 'canned' => false, 'model' => 'claude-opus-5-5',
            'alarm' => ['name' => 'production-rds-db-cpu-warning', 'state' => 'ALARM'],
            'diagnosis' => ['summary' => 'Slow query from the new report', 'confidence' => 'medium', 'evidence' => [], 'next_steps' => []],
        ])]);

        $this->actingAs($this->member)
            ->post('/monitoring/diagnoses', ['alarm_name' => 'production-rds-db-cpu-warning', 'alarm' => ['name' => 'production-rds-db-cpu-warning', 'state' => 'ALARM', 'evil' => 'x']])
            ->assertRedirect();

        $diagnosis = AlarmDiagnosis::sole();
        $this->assertArrayNotHasKey('evil', $diagnosis->alarm);
        $this->assertSame('completed', $diagnosis->status); // the test queue runs jobs immediately
        $this->assertSame('Slow query from the new report', $diagnosis->result['summary']);
        $this->assertFalse($diagnosis->result['canned']);

        Http::assertSent(fn (Request $request) => str_ends_with($request->url(), '/v1/alarms/diagnose')
            && array_keys($request['credentials']) === ['aws', 'llm'] // Slack is never sent
            && $request['credentials']['llm']['provider'] === 'anthropic');
    }

    public function test_failed_diagnosis_keeps_the_service_message(): void
    {
        Http::fake(['*' => Http::response(['detail' => 'Alarm not found.'], 404)]);
        $diagnosis = AlarmDiagnosis::create(['user_id' => $this->member->id, 'alarm_name' => 'gone', 'alarm' => [], 'status' => 'queued']);

        RunAlarmDiagnosis::dispatchSync($diagnosis->id);

        $this->assertSame('failed', $diagnosis->fresh()->status);
        $this->assertSame('Alarm not found.', $diagnosis->fresh()->error);
    }
}
