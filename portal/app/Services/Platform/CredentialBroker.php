<?php

namespace App\Services\Platform;

use App\Enums\ConnectionType;
use App\Models\Connection;

/**
 * Builds the credentials payload for one service call. A service only ever receives the
 * connections listed for it in config/releaseguard.php, and only complete ones.
 *
 * AI is sent as one `llm` object (`provider` plus that provider's fields): the provider in use, or,
 * when a single AI connection is being tested, that connection.
 */
class CredentialBroker
{
    public function __construct(private readonly AiProviderResolver $ai) {}

    /**
     * @param  list<ConnectionType>|null  $only  narrow further, e.g. just the connection being tested
     * @return array<string, array<string, string|null>>
     */
    public function forService(string $service, ?array $only = null): array
    {
        /** @var list<ConnectionType> $allowed */
        $allowed = config("releaseguard.services.{$service}.credentials", []);
        $testedAi = collect($only ?? [])->first(fn (ConnectionType $type) => $type->isAiProvider());

        $credentials = [];
        foreach ($allowed as $type) {
            if ($type === ConnectionType::AiProvider) {
                if ($only === null || $testedAi || in_array(ConnectionType::AiProvider, $only, true)) {
                    $connection = $testedAi ? Connection::for($testedAi) : $this->ai->active();
                    if ($connection?->isComplete()) {
                        $credentials['llm'] = ['provider' => $connection->type->value] + $this->payload($connection->type, $connection);
                    }
                }

                continue;
            }

            if ($only !== null && ! in_array($type, $only, true)) {
                continue;
            }
            $connection = Connection::for($type);
            if ($connection && $connection->isComplete()) {
                $credentials[$type->value] = $this->payload($type, $connection);
            }
        }

        return $credentials;
    }

    /** @return array<string, string|null> */
    private function payload(ConnectionType $type, Connection $connection): array
    {
        $values = [];
        foreach ($type->credentialFields($connection->settings ?? []) as $key) {
            // Claude connections saved before the method choice existed have no auth_method: they are API keys.
            $value = $type === ConnectionType::Anthropic && $key === 'auth_method'
                ? ConnectionType::claudeMethod($connection->settings ?? [])
                : $connection->setting($key);
            $values[$key] = $value === null ? null : (string) $value;
        }

        return $values;
    }
}
