<?php

namespace App\Services\Platform;

use App\Enums\ConnectionType;
use App\Models\Connection;

/**
 * Decides which AI provider the AI features use. An admin either picks one on the Connections page
 * or leaves it on "Automatic", which uses the first provider that is fully set up. An explicit choice
 * that is not set up means no provider (shown honestly), never a silent switch to another one.
 */
class AiProviderResolver
{
    public function active(): ?Connection
    {
        $choice = $this->choice();

        if ($choice !== null) {
            $connection = Connection::for($choice);

            return $connection?->isComplete() ? $connection : null;
        }

        foreach (ConnectionType::AI_PROVIDERS as $type) {
            $connection = Connection::for($type);
            if ($connection?->isComplete()) {
                return $connection;
            }
        }

        return null;
    }

    /** The explicitly chosen provider, or null for Automatic. */
    public function choice(): ?ConnectionType
    {
        $value = Connection::for(ConnectionType::AiProvider)?->setting('provider');
        $type = is_string($value) ? ConnectionType::tryFrom($value) : null;

        return $type?->isAiProvider() ? $type : null;
    }

    /** Plain-language reason no provider is in use, with the next step. */
    public function missingMessage(): string
    {
        $choice = $this->choice();

        return $choice
            ? "{$choice->shortLabel()} is selected as the AI provider but is not set up. An admin must add its key on the Connections page, or choose another provider."
            : 'No AI provider is connected. An admin must add Claude, Gemini, OpenAI or a compatible API on the Connections page.';
    }
}
