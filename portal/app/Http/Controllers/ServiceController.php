<?php

namespace App\Http\Controllers;

use App\Enums\ConnectionType;
use App\Models\Connection;
use App\Services\Platform\ServiceClient;
use Inertia\Inertia;
use Inertia\Response;

class ServiceController extends Controller
{
    public function index(ServiceClient $services): Response
    {
        $connected = collect(ConnectionType::cases())
            ->mapWithKeys(fn (ConnectionType $type) => [$type->value => (bool) Connection::for($type)?->isComplete()]);

        return Inertia::render('services/Index', [
            'services' => array_map(fn (string $name) => $services->status($name), $services->names()),
            'connected' => $connected,
            'labels' => collect(ConnectionType::cases())->mapWithKeys(fn (ConnectionType $type) => [$type->value => $type->label()]),
        ]);
    }
}
