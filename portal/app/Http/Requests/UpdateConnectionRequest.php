<?php

namespace App\Http\Requests;

use App\Enums\ConnectionType;
use App\Models\Connection;
use Illuminate\Foundation\Http\FormRequest;

class UpdateConnectionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return (bool) $this->user()?->isAdmin();
    }

    public function rules(): array
    {
        $type = ConnectionType::from($this->route('type'));
        $existing = Connection::for($type);

        // A secret may be left blank when one is already saved (blank = keep the stored value).
        $secret = fn (string $key) => [
            filled($existing?->setting($key)) ? 'nullable' : 'required', 'string', 'max:2000',
        ];
        // Claude needs only the secret of the chosen sign-in method.
        $claudeSecret = fn (string $key, string $method) => filled($existing?->setting($key))
            ? ['nullable', 'string', 'max:2000']
            : ['nullable', "required_if:auth_method,{$method}", 'string', 'max:2000'];

        // Model ids differ per provider (e.g. "gemini-3.8-flash", "meta-llama/llama-4", "qwen3:8b").
        $model = ['string', 'max:100', 'regex:#^[A-Za-z0-9._:/-]+$#'];

        return match ($type) {
            ConnectionType::AiProvider => [
                'provider' => ['required', 'in:auto,'.implode(',', array_map(fn (ConnectionType $t) => $t->value, ConnectionType::AI_PROVIDERS))],
            ],
            ConnectionType::Gemini => [
                'api_key' => [...$secret('api_key'), 'min:20'],
                'model' => ['nullable', ...$model],
            ],
            ConnectionType::OpenAi => [
                'api_key' => [...$secret('api_key'), 'starts_with:sk-'],
                'model' => ['nullable', ...$model],
            ],
            ConnectionType::OpenAiCompatible => [
                'name' => ['nullable', 'string', 'max:40'],
                // Admin-only setting. http is allowed for local servers such as Ollama.
                'base_url' => ['required', 'string', 'max:255', 'url:http,https'],
                'api_key' => ['nullable', 'string', 'max:2000'],
                'model' => ['required', ...$model],
            ],
            ConnectionType::Anthropic => [
                // Claude subscription sign-ins (claude_code) are deliberately not accepted.
                'auth_method' => ['required', 'in:api_key,server_identity,bedrock'],
                'api_key' => [...$claudeSecret('api_key', 'api_key'), 'starts_with:sk-ant-'],
                'bedrock_region' => ['nullable', 'required_if:auth_method,bedrock', 'string', 'regex:/^[a-z]{2}(-[a-z]+)+-\d$/'],
                // Bedrock keys are optional (empty = the server's IAM role), but must come as a pair.
                'bedrock_access_key_id' => ['nullable', 'string', 'regex:/^(AKIA|ASIA)[A-Z0-9]{12,}$/'],
                'bedrock_secret_access_key' => ['nullable', 'string', 'min:16', 'max:200', 'required_with:bedrock_access_key_id'],
                'model' => ['nullable', 'string', 'max:60', 'regex:/^claude-[a-z0-9-]+$/'],
            ],
            ConnectionType::Atlassian => [
                'site_url' => ['required', 'url:https', 'regex:#^https://[a-z0-9-]+\.atlassian\.net/?$#i'],
                'email' => ['required', 'email', 'max:255'],
                'api_token' => $secret('api_token'),
            ],
            ConnectionType::Slack => [
                'webhook_url' => [...$secret('webhook_url'), 'url:https', 'starts_with:https://hooks.slack.com/'],
            ],
            ConnectionType::CrmDatabase => [
                'host' => ['required', 'string', 'max:255', 'regex:/^[A-Za-z0-9.-]+$/'],
                'port' => ['nullable', 'integer', 'between:1,65535'],
                'database' => ['required', 'string', 'max:64', 'regex:/^[A-Za-z0-9_$-]+$/'],
                'username' => ['required', 'string', 'max:64'],
                'password' => $secret('password'),
                'table_prefix' => ['nullable', 'string', 'max:20', 'regex:/^[A-Za-z0-9_]*$/'],
            ],
            ConnectionType::Aws => [
                'region' => ['required', 'string', 'regex:/^[a-z]{2}(-[a-z]+)+-\d$/'],
                'access_key_id' => [...$secret('access_key_id'), 'regex:/^(AKIA|ASIA)[A-Z0-9]{12,}$/'],
                'secret_access_key' => [...$secret('secret_access_key'), 'min:16'],
                'alarm_prefix' => ['nullable', 'string', 'max:100', 'regex:/^[A-Za-z0-9._-]*$/'],
                'log_group_prefix' => ['nullable', 'string', 'max:200', 'regex:#^/[A-Za-z0-9._/-]*$#'],
            ],
        };
    }

    public function messages(): array
    {
        return [
            'site_url.regex' => 'Use your Atlassian Cloud address, e.g. https://your-company.atlassian.net',
            'webhook_url.starts_with' => 'Use a Slack incoming webhook URL (https://hooks.slack.com/…).',
            'api_key.starts_with' => $this->route('type') === ConnectionType::OpenAi->value ? 'OpenAI API keys start with sk-.' : 'Claude API keys start with sk-ant-.',
            'model.regex' => 'Use the model id exactly as the provider lists it.',
            'base_url.url' => 'Use the provider\'s API address, e.g. https://api.groq.com/openai/v1',
            'region.regex' => 'Use an AWS region code such as ap-southeast-1.',
            'access_key_id.regex' => 'This does not look like an AWS access key ID.',
        ];
    }
}
