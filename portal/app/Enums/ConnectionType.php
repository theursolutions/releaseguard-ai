<?php

namespace App\Enums;

enum ConnectionType: string
{
    // Which AI provider powers the AI features (a choice, not a credential).
    case AiProvider = 'ai';
    case Anthropic = 'anthropic';
    case Gemini = 'gemini';
    case OpenAi = 'openai';
    case OpenAiCompatible = 'openai_compatible';
    case Atlassian = 'atlassian';
    case Slack = 'slack';
    case Aws = 'aws';
    case CrmDatabase = 'crm_db';

    /** The AI providers, in the order "Automatic" tries them. */
    public const AI_PROVIDERS = [self::Anthropic, self::Gemini, self::OpenAi, self::OpenAiCompatible];

    public function isAiProvider(): bool
    {
        return in_array($this, self::AI_PROVIDERS, true);
    }

    public function label(): string
    {
        return match ($this) {
            self::AiProvider => 'AI provider in use',
            self::Anthropic => 'Claude (Anthropic)',
            self::Gemini => 'Google Gemini',
            self::OpenAi => 'OpenAI',
            self::OpenAiCompatible => 'OpenAI-compatible API',
            self::Atlassian => 'Jira & Confluence',
            self::Slack => 'Slack',
            self::Aws => 'AWS (read-only)',
            self::CrmDatabase => 'CRM & HomeNet database (read-only)',
        };
    }

    /** Short name used in status messages, e.g. "Gemini is selected…". */
    public function shortLabel(): string
    {
        return match ($this) {
            self::Anthropic => 'Claude',
            self::Gemini => 'Gemini',
            default => $this->label(),
        };
    }

    public function description(): string
    {
        return match ($this) {
            self::AiProvider => 'Choose which connected AI powers the assistant, the PRD checker and alarm diagnosis. Automatic uses the first one that is set up.',
            self::Anthropic => 'Claude models through a company API key, server identity or Amazon Bedrock.',
            self::Gemini => 'Google Gemini models with an API key from Google AI Studio or Google Cloud.',
            self::OpenAi => 'OpenAI models with an API key from platform.openai.com.',
            self::OpenAiCompatible => 'Groq, Mistral, DeepSeek, OpenRouter, xAI, Together, or a local Ollama / LM Studio server.',
            self::Atlassian => 'Reads PRDs from Confluence and tickets from Jira.',
            self::Slack => 'Sends test messages and notifications to a channel.',
            self::Aws => 'Reads CloudWatch alarms, metrics and forecasts for the Monitoring page.',
            self::CrmDatabase => 'Agent, agency and sales performance, and sign-in with CRM accounts. Use a SELECT-only database user.',
        };
    }

    /**
     * Field definitions shown on the Connections page. Secret fields are never sent to the browser.
     *
     * @return array<string, array<string, mixed>>
     */
    public function fields(): array
    {
        return match ($this) {
            self::AiProvider => [
                'provider' => [
                    'label' => 'Provider', 'secret' => false, 'type' => 'select', 'placeholder' => '',
                    'options' => [
                        'auto' => 'Automatic (first one set up)',
                        self::Anthropic->value => 'Claude',
                        self::Gemini->value => 'Google Gemini',
                        self::OpenAi->value => 'OpenAI',
                        self::OpenAiCompatible->value => 'OpenAI-compatible API',
                    ],
                    'help' => 'Personal Claude, ChatGPT or Gemini app sign-ins cannot be used by a server. Each provider needs an API key.',
                ],
            ],
            self::Anthropic => [
                // Only officially permitted runtime methods. Claude subscription sign-ins (claude.ai,
                // `claude setup-token`) are reserved for Claude Code by Anthropic's terms, so they are not offered.
                'auth_method' => [
                    'label' => 'Connection method', 'secret' => false, 'type' => 'select', 'placeholder' => '',
                    'options' => [
                        'api_key' => 'Company API key (Claude Console)',
                        'server_identity' => 'Server identity (configured by DevOps)',
                        'bedrock' => 'Amazon Bedrock (company AWS)',
                    ],
                ],
                'api_key' => [
                    'label' => 'API key', 'secret' => true, 'placeholder' => 'sk-ant-…',
                    'help' => 'Ask your Claude Team Owner to link a Claude Console organisation (Team plans include monthly API credits) and create a service-account key for ReleaseGuard.',
                    'show_when' => ['auth_method' => 'api_key'],
                ],
                'bedrock_region' => [
                    'label' => 'AWS region', 'secret' => false, 'placeholder' => 'us-east-1',
                    'help' => 'Claude must be enabled in Amazon Bedrock for this AWS account and region. Billed through AWS.',
                    'show_when' => ['auth_method' => 'bedrock'],
                ],
                'bedrock_access_key_id' => [
                    'label' => 'AWS access key ID (optional)', 'secret' => true, 'placeholder' => 'Leave empty to use the server\'s IAM role',
                    'show_when' => ['auth_method' => 'bedrock'],
                ],
                'bedrock_secret_access_key' => [
                    'label' => 'AWS secret access key (optional)', 'secret' => true, 'placeholder' => '',
                    'show_when' => ['auth_method' => 'bedrock'],
                ],
                'model' => ['label' => 'Model (optional)', 'secret' => false, 'placeholder' => 'claude-opus-5-5'],
            ],
            self::Gemini => [
                'api_key' => [
                    'label' => 'API key', 'secret' => true, 'placeholder' => 'AIza…',
                    'help' => 'Create one at aistudio.google.com → Get API key. On the free tier Google may use prompts to improve its products, so use a paid key for real company data.',
                ],
                'model' => ['label' => 'Model (optional)', 'secret' => false, 'placeholder' => 'gemini-3.8-flash'],
            ],
            self::OpenAi => [
                'api_key' => ['label' => 'API key', 'secret' => true, 'placeholder' => 'sk-…', 'help' => 'Create a project key at platform.openai.com → API keys.'],
                'model' => ['label' => 'Model (optional)', 'secret' => false, 'placeholder' => 'gpt-6.1-sol'],
            ],
            self::OpenAiCompatible => [
                'name' => ['label' => 'Display name', 'secret' => false, 'placeholder' => 'Groq'],
                'base_url' => [
                    'label' => 'Base URL', 'secret' => false, 'placeholder' => 'https://api.groq.com/openai/v1',
                    'help' => 'Groq https://api.groq.com/openai/v1 · Mistral https://api.mistral.ai/v1 · DeepSeek https://api.deepseek.com · OpenRouter https://openrouter.ai/api/v1 · xAI https://api.x.ai/v1 · Ollama on this computer http://host.docker.internal:11434/v1',
                ],
                'api_key' => ['label' => 'API key (optional for local servers)', 'secret' => true, 'placeholder' => ''],
                'model' => ['label' => 'Model', 'secret' => false, 'placeholder' => 'e.g. llama-3.3-70b-versatile'],
            ],
            self::Atlassian => [
                'site_url' => ['label' => 'Site URL', 'secret' => false, 'placeholder' => 'https://your-company.atlassian.net'],
                'email' => ['label' => 'Account email', 'secret' => false, 'placeholder' => 'service-account@company.com'],
                'api_token' => ['label' => 'API token', 'secret' => true, 'placeholder' => 'Create at id.atlassian.com → Security → API tokens'],
            ],
            self::Slack => [
                'webhook_url' => ['label' => 'Incoming webhook URL', 'secret' => true, 'placeholder' => 'https://hooks.slack.com/services/…'],
            ],
            self::Aws => [
                'region' => ['label' => 'Region', 'secret' => false, 'placeholder' => 'ap-southeast-1'],
                'access_key_id' => ['label' => 'Access key ID', 'secret' => true, 'placeholder' => 'AKIA…', 'help' => 'Use an IAM user limited to CloudWatch read access.'],
                'secret_access_key' => ['label' => 'Secret access key', 'secret' => true, 'placeholder' => ''],
                'alarm_prefix' => ['label' => 'Alarm name prefix (optional)', 'secret' => false, 'placeholder' => 'production-'],
                'log_group_prefix' => ['label' => 'App log group prefix (optional)', 'secret' => false, 'placeholder' => '/releaseguard/production/', 'help' => 'Lets the AI read recent application errors when diagnosing.'],
            ],
            self::CrmDatabase => [
                'host' => ['label' => 'Host', 'secret' => false, 'placeholder' => 'db.internal or host.docker.internal', 'help' => 'For a MySQL server on this computer (Laragon), use host.docker.internal.'],
                'port' => ['label' => 'Port', 'secret' => false, 'placeholder' => '3306'],
                'database' => ['label' => 'Database (schema)', 'secret' => false, 'placeholder' => 'homenet'],
                'username' => ['label' => 'Username', 'secret' => false, 'placeholder' => 'releaseguard_ro', 'help' => 'Create it with: GRANT SELECT ON homenet.* TO releaseguard_ro'],
                'password' => ['label' => 'Password', 'secret' => true, 'placeholder' => ''],
                'table_prefix' => ['label' => 'CRM table prefix', 'secret' => false, 'placeholder' => 'crm_'],
            ],
        };
    }

    /**
     * Fields that must be filled for the connection to be usable, given its saved settings.
     *
     * @param  array<string, mixed>  $settings
     * @return list<string>
     */
    public function requiredFields(array $settings = []): array
    {
        return match ($this) {
            self::AiProvider => ['provider'],
            self::Anthropic => match (self::claudeMethod($settings)) {
                'bedrock' => ['bedrock_region'],
                'server_identity' => [], // the credential lives on the service, not in the portal
                default => ['api_key'],
            },
            self::Gemini, self::OpenAi => ['api_key'],
            self::OpenAiCompatible => ['base_url', 'model'],
            self::Atlassian => ['site_url', 'email', 'api_token'],
            self::Slack => ['webhook_url'],
            self::Aws => ['region', 'access_key_id', 'secret_access_key'],
            self::CrmDatabase => ['host', 'database', 'username', 'password'],
        };
    }

    /**
     * Fields sent to a service. For Claude only the fields of the chosen method are sent.
     *
     * @param  array<string, mixed>  $settings
     * @return list<string>
     */
    public function credentialFields(array $settings): array
    {
        if ($this !== self::Anthropic) {
            return array_keys($this->fields());
        }

        return match (self::claudeMethod($settings)) {
            'bedrock' => ['auth_method', 'model', 'bedrock_region', 'bedrock_access_key_id', 'bedrock_secret_access_key'],
            'server_identity' => ['auth_method', 'model'],
            default => ['auth_method', 'model', 'api_key'],
        };
    }

    /** @param array<string, mixed> $settings */
    public static function claudeMethod(array $settings): string
    {
        $method = $settings['auth_method'] ?? 'api_key';

        return in_array($method, ['api_key', 'server_identity', 'bedrock'], true) ? $method : 'api_key';
    }
}
