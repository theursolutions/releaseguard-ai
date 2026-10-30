<?php

use App\Enums\ConnectionType;

return [

    /*
    | Registered microservices. The portal is the only caller; each service checks the token.
    | 'credentials' lists the connections the portal may send to that service. Nothing else
    | is ever shared with it. AiProvider means "the AI provider in use" (sent as `llm`).
    */
    'services' => [
        'prd' => [
            'title' => 'PRD Checker',
            'url' => env('PRD_SERVICE_URL', 'http://127.0.0.1:8101'),
            'token' => env('PRD_SERVICE_TOKEN'),
            'timeout' => (int) env('PRD_SERVICE_TIMEOUT', 600),
            'credentials' => [ConnectionType::AiProvider, ConnectionType::Atlassian],
        ],
        'monitoring' => [
            'title' => 'Monitoring',
            'url' => env('MONITORING_SERVICE_URL', 'http://127.0.0.1:8102'),
            'token' => env('MONITORING_SERVICE_TOKEN'),
            'timeout' => (int) env('MONITORING_SERVICE_TIMEOUT', 300),
            'credentials' => [ConnectionType::Aws, ConnectionType::AiProvider, ConnectionType::Slack],
        ],
        'assistant' => [
            'title' => 'Executive Assistant',
            'url' => env('ASSISTANT_SERVICE_URL', 'http://127.0.0.1:8103'),
            'token' => env('ASSISTANT_SERVICE_TOKEN'),
            'timeout' => (int) env('ASSISTANT_SERVICE_TIMEOUT', 300),
            // Business data reaches the assistant only through tool calls back to the portal.
            'credentials' => [ConnectionType::AiProvider],
        ],
        'performance' => [
            'title' => 'Performance',
            'url' => env('PERFORMANCE_SERVICE_URL', 'http://127.0.0.1:8104'),
            'token' => env('PERFORMANCE_SERVICE_TOKEN'),
            'timeout' => (int) env('PERFORMANCE_SERVICE_TIMEOUT', 60),
            'credentials' => [ConnectionType::CrmDatabase],
        ],
    ],

    'assistant' => [
        // Status checks call the provider; keep the result briefly so page loads stay fast.
        'status_cache_seconds' => 60,
        'history_messages' => 20,
        // The command-centre widgets poll /assistant/live; slower sources are kept briefly.
        'live' => [
            'services_cache_seconds' => 10,
            'performance_cache_seconds' => 60,
            // The sales widget gives up on a slow CRM query after this long (the widget shows why).
            'performance_timeout_seconds' => 25,
        ],
    ],

    // Module A, the Claude Code toolkit, shown on the assistant's Toolkit widget and the Toolkit page (read-only).
    'toolkit' => [
        'path' => env('TOOLKIT_PATH', base_path('../toolkit')),
        // Optional: when set, the Toolkit page also shows "git clone" install steps.
        'repo_url' => env('TOOLKIT_REPO_URL'),
        'cache_seconds' => 600,
    ],

    // Which service tests each connection (the portal itself never calls external APIs).
    'connection_testers' => [
        ConnectionType::AiProvider->value => 'prd',
        ConnectionType::Anthropic->value => 'prd',
        ConnectionType::Gemini->value => 'prd',
        ConnectionType::OpenAi->value => 'prd',
        ConnectionType::OpenAiCompatible->value => 'prd',
        ConnectionType::Atlassian->value => 'prd',
        ConnectionType::Aws->value => 'monitoring',
        ConnectionType::Slack->value => 'monitoring',
        ConnectionType::CrmDatabase->value => 'performance',
    ],

    'prd' => [
        'max_upload_kb' => 20 * 1024,
        'ready_score' => 70,
        // One flow correction is a small AI request; it runs while the person waits.
        'flow_revision_timeout' => 90,
    ],
];
