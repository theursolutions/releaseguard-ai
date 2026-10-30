<?php

namespace Tests\Feature\Portal;

use App\Enums\ConnectionType;
use App\Models\Connection;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class ConnectionsTest extends TestCase
{
    use RefreshDatabase;

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->admin = User::factory()->admin()->create();
        config([
            'releaseguard.services.prd.url' => 'http://prd.test',
            'releaseguard.services.prd.token' => 'prd-token',
            'releaseguard.services.monitoring.url' => 'http://monitoring.test',
            'releaseguard.services.monitoring.token' => 'monitoring-token',
        ]);
    }

    public function test_secrets_are_encrypted_at_rest_and_never_sent_to_the_browser(): void
    {
        $this->actingAs($this->admin)
            ->put('/connections/anthropic', ['auth_method' => 'api_key', 'api_key' => 'sk-ant-supersecret-123456789', 'model' => 'claude-opus-5-5'])
            ->assertSessionHasNoErrors();

        $raw = DB::table('connections')->where('type', 'anthropic')->value('settings');
        $this->assertStringNotContainsString('supersecret', $raw);
        $this->assertSame('sk-ant-supersecret-123456789', Connection::for(ConnectionType::Anthropic)->setting('api_key'));

        $response = $this->actingAs($this->admin)->get('/connections');
        $response->assertDontSee('supersecret');
        $response->assertInertia(fn ($page) => $page
            ->where('connections.1.type', 'anthropic')
            ->where('connections.1.fields.api_key.value', '')
            ->where('connections.1.fields.api_key.is_set', true)
            ->where('connections.1.fields.api_key.hint', '••••6789')
            ->where('connections.1.fields.model.value', 'claude-opus-5-5'));
    }

    public function test_claude_subscription_sign_in_is_not_offered_or_accepted(): void
    {
        // Anthropic's terms reserve claude.ai / `claude setup-token` sign-ins for Claude Code.
        $this->actingAs($this->admin)
            ->put('/connections/anthropic', ['auth_method' => 'claude_code', 'oauth_token' => 'sk-ant-oat01-demo-token-1234567890'])
            ->assertSessionHasErrors('auth_method');
        $this->assertNull(Connection::for(ConnectionType::Anthropic));

        $this->actingAs($this->admin)->get('/connections')->assertInertia(fn ($page) => $page
            ->where('connections.1.type', 'anthropic')
            ->has('connections.1.fields.auth_method.options.api_key')
            ->missing('connections.1.fields.oauth_token')
            ->missing('connections.1.fields.auth_method.options.claude_code'));
    }

    public function test_bedrock_sends_only_bedrock_fields(): void
    {
        $this->actingAs($this->admin)->put('/connections/anthropic', ['auth_method' => 'api_key', 'api_key' => 'sk-ant-old-key-123456789']);
        $this->actingAs($this->admin)
            ->put('/connections/anthropic', ['auth_method' => 'bedrock', 'bedrock_region' => 'us-east-1'])
            ->assertSessionHasNoErrors();
        $this->assertTrue(Connection::for(ConnectionType::Anthropic)->isComplete());

        Http::fake(['http://prd.test/*' => Http::response(['ok' => true, 'message' => 'Connected to Claude on Amazon Bedrock.'])]);
        $this->actingAs($this->admin)->post('/connections/anthropic/test')->assertSessionHas('success');

        Http::assertSent(function (Request $request) {
            $claude = $request['credentials']['llm'];

            return $claude['provider'] === 'anthropic'
                && $claude['auth_method'] === 'bedrock'
                && $claude['bedrock_region'] === 'us-east-1'
                && ! array_key_exists('api_key', $claude); // the old API key never leaves the portal
        });
    }

    public function test_server_identity_needs_no_secret_in_the_portal(): void
    {
        $this->actingAs($this->admin)->put('/connections/anthropic', ['auth_method' => 'server_identity'])->assertSessionHasNoErrors();
        $this->assertTrue(Connection::for(ConnectionType::Anthropic)->isComplete());
    }

    public function test_the_chosen_method_needs_its_fields(): void
    {
        $this->actingAs($this->admin)->put('/connections/anthropic', ['auth_method' => 'api_key'])->assertSessionHasErrors('api_key');
        $this->actingAs($this->admin)->put('/connections/anthropic', ['auth_method' => 'bedrock'])->assertSessionHasErrors('bedrock_region');
        $this->actingAs($this->admin)->put('/connections/anthropic', ['auth_method' => 'bedrock', 'bedrock_region' => 'us-east-1', 'bedrock_access_key_id' => 'AKIAABCDEFGHIJKLMNOP'])
            ->assertSessionHasErrors('bedrock_secret_access_key');
        $this->actingAs($this->admin)->put('/connections/anthropic', ['auth_method' => 'magic'])->assertSessionHasErrors('auth_method');
    }

    public function test_leaving_a_secret_blank_keeps_the_saved_value(): void
    {
        $this->actingAs($this->admin)->put('/connections/anthropic', ['auth_method' => 'api_key', 'api_key' => 'sk-ant-original-123456789']);
        $this->actingAs($this->admin)->put('/connections/anthropic', ['auth_method' => 'api_key', 'api_key' => '', 'model' => 'claude-sonnet-5-5'])->assertSessionHasNoErrors();

        $connection = Connection::for(ConnectionType::Anthropic);
        $this->assertSame('sk-ant-original-123456789', $connection->setting('api_key'));
        $this->assertSame('claude-sonnet-5-5', $connection->setting('model'));
    }

    public function test_connection_details_are_validated(): void
    {
        $this->actingAs($this->admin)->put('/connections/atlassian', ['site_url' => 'https://evil.example.com', 'email' => 'a@b.com', 'api_token' => 'x'])
            ->assertSessionHasErrors('site_url');
        $this->actingAs($this->admin)->put('/connections/slack', ['webhook_url' => 'https://example.com/hook'])
            ->assertSessionHasErrors('webhook_url');
        $this->actingAs($this->admin)->put('/connections/aws', ['region' => 'nowhere', 'access_key_id' => 'nope', 'secret_access_key' => 'short'])
            ->assertSessionHasErrors(['region', 'access_key_id', 'secret_access_key']);
        $this->actingAs($this->admin)->put('/connections/anthropic', ['auth_method' => 'api_key', 'api_key' => 'not-a-claude-key'])
            ->assertSessionHasErrors('api_key');
        $this->actingAs($this->admin)->put('/connections/unknown', [])->assertNotFound();
    }

    public function test_testing_a_connection_goes_through_its_service_with_only_that_credential(): void
    {
        $this->saveAll();
        Http::fake(['http://prd.test/*' => Http::response(['ok' => true, 'message' => 'Connected. Model claude-opus-5-5 is available.'])]);

        $this->actingAs($this->admin)->post('/connections/anthropic/test')->assertSessionHas('success', 'Connected. Model claude-opus-5-5 is available.');

        Http::assertSent(function (Request $request) {
            return $request->url() === 'http://prd.test/v1/connections/test'
                && $request->hasHeader('Authorization', 'Bearer prd-token')
                && $request['connection'] === 'anthropic'
                && array_keys($request['credentials']) === ['llm']
                && $request['credentials']['llm']['provider'] === 'anthropic';
        });
        $this->assertSame('connected', Connection::for(ConnectionType::Anthropic)->status);
    }

    public function test_each_ai_provider_is_validated_and_tested_on_its_own(): void
    {
        $this->actingAs($this->admin)->put('/connections/gemini', ['api_key' => 'short'])->assertSessionHasErrors('api_key');
        $this->actingAs($this->admin)->put('/connections/openai', ['api_key' => 'not-openai-key-123456'])->assertSessionHasErrors('api_key');
        $this->actingAs($this->admin)->put('/connections/openai_compatible', ['base_url' => 'ftp://example.com', 'model' => ''])->assertSessionHasErrors(['base_url', 'model']);
        $this->actingAs($this->admin)->put('/connections/gemini', ['api_key' => 'AIzaSyTestKey1234567890', 'model' => 'bad model!'])->assertSessionHasErrors('model');
        $this->actingAs($this->admin)->put('/connections/ai', ['provider' => 'chatgpt_login'])->assertSessionHasErrors('provider');

        $this->saveAll();
        $this->actingAs($this->admin)->put('/connections/gemini', ['api_key' => 'AIzaSyTestKey1234567890', 'model' => 'gemini-3.8-flash'])->assertSessionHasNoErrors();
        $this->actingAs($this->admin)->put('/connections/openai_compatible', ['name' => 'Groq', 'base_url' => 'https://api.groq.com/openai/v1/', 'model' => 'llama-3.3-70b-versatile'])->assertSessionHasNoErrors();
        $this->assertSame('https://api.groq.com/openai/v1', Connection::for(ConnectionType::OpenAiCompatible)->setting('base_url'));

        Http::fake(['http://prd.test/*' => Http::response(['ok' => true, 'message' => 'Connected to Gemini.'])]);
        $this->actingAs($this->admin)->post('/connections/gemini/test')->assertSessionHas('success', 'Connected to Gemini.');

        // Testing Gemini sends Gemini, even though Claude is also connected (and first in Automatic order).
        Http::assertSent(fn (Request $request) => $request['connection'] === 'gemini'
            && $request['credentials']['llm'] === ['provider' => 'gemini', 'api_key' => 'AIzaSyTestKey1234567890', 'model' => 'gemini-3.8-flash']);
    }

    public function test_aws_is_tested_by_the_monitoring_service(): void
    {
        $this->saveAll();
        Http::fake(['http://monitoring.test/*' => Http::response(['ok' => false, 'message' => 'AWS rejected the request (InvalidClientTokenId).'])]);

        $this->actingAs($this->admin)->post('/connections/aws/test')->assertSessionHas('error');

        Http::assertSent(fn (Request $request) => $request->url() === 'http://monitoring.test/v1/connections/test' && array_keys($request['credentials']) === ['aws']);
        $connection = Connection::for(ConnectionType::Aws);
        $this->assertSame('failed', $connection->status);
        $this->assertStringContainsString('InvalidClientTokenId', $connection->last_error);
    }

    public function test_an_unreachable_service_is_reported_not_thrown(): void
    {
        $this->saveAll();
        Http::fake(fn () => throw new ConnectionException('refused'));

        $this->actingAs($this->admin)->post('/connections/slack/test')
            ->assertSessionHas('error', 'The Monitoring service is not reachable. Check that it is running.');
    }

    private function saveAll(): void
    {
        $this->actingAs($this->admin)->put('/connections/anthropic', ['auth_method' => 'api_key', 'api_key' => 'sk-ant-test-123456789']);
        $this->actingAs($this->admin)->put('/connections/aws', ['region' => 'ap-southeast-1', 'access_key_id' => 'AKIAABCDEFGHIJKLMNOP', 'secret_access_key' => 'secretsecretsecretsecret']);
        $this->actingAs($this->admin)->put('/connections/slack', ['webhook_url' => 'https://hooks.slack.com/services/T000/B000/XXXX']);
    }
}
