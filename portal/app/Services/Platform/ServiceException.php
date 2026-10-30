<?php

namespace App\Services\Platform;

use RuntimeException;

/** A microservice call failed. The message is safe to show in the UI. */
class ServiceException extends RuntimeException
{
    /** @param int|null $status the service's HTTP status, or null when it was not reached */
    public function __construct(string $message, public readonly ?int $status = null)
    {
        parent::__construct($message);
    }
}
