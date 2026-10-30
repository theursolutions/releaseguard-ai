<?php

namespace Tests\Feature\Portal;

use App\Enums\ConnectionType;
use App\Jobs\RunPrdAnalysis;
use App\Models\Connection;
use App\Models\PrdAnalysis;
use App\Models\User;
use App\Services\Platform\CredentialBroker;
use App\Services\Platform\ServiceClient;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class PrdCheckerTest extends TestCase
{
    use RefreshDatabase;

    private User $member;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->member = User::factory()->create();
        config(['releaseguard.services.prd.url' => 'http://prd.test', 'releaseguard.services.prd.token' => 'prd-token']);
    }

    private function connect(ConnectionType ...$types): void
    {
        $settings = [
            'anthropic' => ['auth_method' => 'api_key', 'api_key' => 'sk-ant-test-123456789', 'model' => ''],
            'atlassian' => ['site_url' => 'https://acme.atlassian.net', 'email' => 'bot@acme.com', 'api_token' => 'atl-token'],
            'aws' => ['region' => 'ap-southeast-1', 'access_key_id' => 'AKIAABCDEFGHIJKLMNOP', 'secret_access_key' => 'secretsecretsecret', 'alarm_prefix' => '', 'log_group_prefix' => ''],
            'slack' => ['webhook_url' => 'https://hooks.slack.com/services/x'],
        ];
        foreach ($types as $type) {
            Connection::create(['type' => $type, 'settings' => $settings[$type->value], 'status' => 'connected']);
        }
    }

    public function test_upload_is_stored_privately_and_queued(): void
    {
        Queue::fake();
        $this->connect(ConnectionType::Anthropic);

        $response = $this->actingAs($this->member)->post('/prd', [
            'source_type' => 'upload',
            'file' => UploadedFile::fake()->createWithContent('agent-invites.txt', str_repeat('Owners invite agents by email. ', 10)),
        ]);

        $response->assertSessionHasNoErrors();
        $analysis = PrdAnalysis::sole();
        $response->assertRedirect("/prd/{$analysis->id}");
        $this->assertSame('agent-invites', $analysis->title);
        $this->assertStringStartsWith('prd-uploads/', $analysis->file_path);
        $this->assertStringNotContainsString('agent-invites', $analysis->file_path);
        Storage::disk('local')->assertExists($analysis->file_path);
        Queue::assertPushed(RunPrdAnalysis::class, fn ($job) => $job->analysisId === $analysis->id);
    }

    public function test_uploads_are_validated(): void
    {
        $this->connect(ConnectionType::Anthropic);

        $this->actingAs($this->member)->post('/prd', ['source_type' => 'upload', 'file' => UploadedFile::fake()->create('malware.exe', 10, 'application/x-msdownload')])
            ->assertSessionHasErrors('file');
        $this->actingAs($this->member)->post('/prd', ['source_type' => 'upload', 'file' => UploadedFile::fake()->create('huge.pdf', 21 * 1024, 'application/pdf')])
            ->assertSessionHasErrors('file');
        $this->actingAs($this->member)->post('/prd', ['source_type' => 'text', 'text' => 'too short'])
            ->assertSessionHasErrors('text');
        $this->assertSame(0, PrdAnalysis::count());
    }

    public function test_claude_must_be_connected_and_confluence_needs_its_connection(): void
    {
        $this->actingAs($this->member)->post('/prd', ['source_type' => 'text', 'text' => str_repeat('Requirement text. ', 10)])
            ->assertSessionHasErrors('source_type');

        $this->connect(ConnectionType::Anthropic);
        $this->actingAs($this->member)->post('/prd', ['source_type' => 'confluence', 'url' => 'https://acme.atlassian.net/wiki/pages/1'])
            ->assertSessionHasErrors('url');
    }

    public function test_job_sends_only_prd_credentials_and_saves_the_result(): void
    {
        $this->connect(ConnectionType::Anthropic, ConnectionType::Atlassian, ConnectionType::Aws, ConnectionType::Slack);
        $analysis = PrdAnalysis::create(['user_id' => $this->member->id, 'title' => 'Invites', 'source_type' => 'text', 'source_text' => 'Owners invite agents.', 'status' => 'queued']);
        Http::fake(['http://prd.test/v1/analyses' => Http::response([
            'result' => ['summary' => 'Good start', 'questions' => [], 'score_breakdown' => []],
            'score' => 72, 'ready' => true, 'model' => 'claude-opus-5-5',
            'usage' => ['input_tokens' => 1500, 'output_tokens' => 800], 'source_title' => null,
        ])]);

        (new RunPrdAnalysis($analysis->id))->handle(app(ServiceClient::class), app(CredentialBroker::class));

        Http::assertSent(function (Request $request) {
            return $request->hasHeader('Authorization', 'Bearer prd-token')
                && $request['document'] === ['kind' => 'text', 'text' => 'Owners invite agents.']
                && array_keys($request['credentials']) === ['llm', 'atlassian'] // never AWS or Slack
                && $request['credentials']['llm']['provider'] === 'anthropic';
        });
        $analysis->refresh();
        $this->assertSame('completed', $analysis->status);
        $this->assertSame(72, $analysis->score);
        $this->assertSame('Good start', $analysis->result['summary']);
        $this->assertSame(1500, $analysis->input_tokens);
    }

    public function test_pdf_uploads_are_sent_as_base64_documents(): void
    {
        $this->connect(ConnectionType::Anthropic);
        Storage::disk('local')->put('prd-uploads/abc.pdf', '%PDF-1.4 sample');
        $analysis = PrdAnalysis::create(['user_id' => $this->member->id, 'title' => 'Spec', 'source_type' => 'upload', 'file_path' => 'prd-uploads/abc.pdf', 'file_mime' => 'application/pdf', 'status' => 'queued']);
        Http::fake(['*' => Http::response(['result' => [], 'score' => 10, 'model' => 'm', 'usage' => ['input_tokens' => 1, 'output_tokens' => 1]])]);

        RunPrdAnalysis::dispatchSync($analysis->id);

        Http::assertSent(fn (Request $request) => $request['document'] === ['kind' => 'pdf', 'data_base64' => base64_encode('%PDF-1.4 sample')]);
    }

    public function test_service_errors_are_shown_to_the_user(): void
    {
        $this->connect(ConnectionType::Anthropic);
        $analysis = PrdAnalysis::create(['user_id' => $this->member->id, 'title' => 'Invites', 'source_type' => 'text', 'source_text' => 'x', 'status' => 'queued']);
        Http::fake(['*' => Http::response(['detail' => 'The Claude API key was rejected. Update it on the Connections page.'], 422)]);

        RunPrdAnalysis::dispatchSync($analysis->id);

        $analysis->refresh();
        $this->assertSame('failed', $analysis->status);
        $this->assertSame('The Claude API key was rejected. Update it on the Connections page.', $analysis->error);
    }

    public function test_unexpected_service_errors_are_not_leaked(): void
    {
        $this->connect(ConnectionType::Anthropic);
        $analysis = PrdAnalysis::create(['user_id' => $this->member->id, 'title' => 'Invites', 'source_type' => 'text', 'source_text' => 'x', 'status' => 'queued']);
        Http::fake(['*' => Http::response('Traceback (most recent call last): secret internals', 500)]);

        RunPrdAnalysis::dispatchSync($analysis->id);

        $this->assertStringNotContainsString('Traceback', $analysis->fresh()->error);
    }

    public function test_only_the_author_or_an_admin_can_delete(): void
    {
        $analysis = PrdAnalysis::create(['user_id' => $this->member->id, 'title' => 'Invites', 'source_type' => 'text', 'source_text' => 'x', 'status' => 'failed']);
        $colleague = User::factory()->create();

        $this->actingAs($colleague)->get("/prd/{$analysis->id}")->assertOk();
        $this->actingAs($colleague)->delete("/prd/{$analysis->id}")->assertForbidden();
        $this->actingAs($colleague)->post("/prd/{$analysis->id}/rerun")->assertForbidden();

        $this->actingAs(User::factory()->admin()->create())->delete("/prd/{$analysis->id}")->assertRedirect('/prd');
        $this->assertModelMissing($analysis);
    }

    public function test_completed_review_exports_as_markdown(): void
    {
        $analysis = PrdAnalysis::create([
            'user_id' => $this->member->id, 'title' => 'Agent Invites', 'source_type' => 'text', 'source_text' => 'x', 'status' => 'completed', 'score' => 64,
            'completed_at' => now(),
            'result' => [
                'summary' => 'Mostly clear.',
                'score_breakdown' => [['area' => 'edge_cases', 'label' => 'Edge and error cases defined', 'points' => 8, 'max' => 20, 'reason' => 'Few | cases']],
                'questions' => [['flow_id' => 'FLOW-OWNER-01', 'question' => 'Can invites expire?', 'why_it_matters' => 'Security', 'blocking' => true]],
                'actors' => [], 'flows' => [], 'dependencies' => [], 'contradictions' => [], 'out_of_scope' => [],
                'diagrams' => [['actor' => 'Owner', 'mermaid' => 'flowchart TD\n A["Invite"] --> B["Accept"]']],
            ],
        ]);

        $response = $this->actingAs($this->member)->get("/prd/{$analysis->id}/export");

        $response->assertOk()->assertDownload('agent-invites-prd-review.md');
        $markdown = $response->streamedContent();
        $this->assertStringContainsString('**Readiness score:** 64/100 (Not ready for sprint)', $markdown);
        $this->assertStringContainsString('Can invites expire? **(blocking)**', $markdown);
        $this->assertStringContainsString('Few \| cases', $markdown);
        $this->assertStringContainsString('```mermaid', $markdown);
    }
}
