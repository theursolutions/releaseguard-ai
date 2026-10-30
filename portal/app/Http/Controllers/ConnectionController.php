<?php

namespace App\Http\Controllers;

use App\Enums\ConnectionType;
use App\Http\Requests\UpdateConnectionRequest;
use App\Models\Connection;
use App\Services\Connections\ConnectionStore;
use App\Services\Platform\CredentialBroker;
use App\Services\Platform\ServiceClient;
use App\Services\Platform\ServiceException;
use Illuminate\Http\RedirectResponse;
use Illuminate\Support\Facades\Log;
use Inertia\Inertia;
use Inertia\Response;

class ConnectionController extends Controller
{
    public function __construct(private readonly ConnectionStore $store) {}

    public function index(): Response
    {
        return Inertia::render('connections/Index', [
            'connections' => array_values($this->store->present()),
        ]);
    }

    public function update(UpdateConnectionRequest $request, string $type): RedirectResponse
    {
        $connectionType = ConnectionType::from($type);
        $this->store->save($connectionType, $request->validated(), $request->user());
        Log::info('Connection updated', ['type' => $type, 'user' => $request->user()->id]);

        return back()->with('success', "{$connectionType->label()} saved. Run a test to confirm it works.");
    }

    public function test(string $type, ServiceClient $services, CredentialBroker $broker): RedirectResponse
    {
        $connectionType = ConnectionType::from($type);
        $connection = Connection::for($connectionType);
        if (! $connection || ! $connection->isComplete()) {
            return back()->with('error', 'Save the connection details first.');
        }

        $service = config("releaseguard.connection_testers.{$type}");

        try {
            $result = $services->post($service, '/v1/connections/test', [
                'connection' => $type,
                'credentials' => $broker->forService($service, [$connectionType]),
            ]);
            $ok = (bool) ($result['ok'] ?? false);
            $message = (string) ($result['message'] ?? 'No response.');
        } catch (ServiceException $e) {
            $ok = false;
            $message = $e->getMessage();
        }

        $connection->update([
            'status' => $ok ? 'connected' : 'failed',
            'last_tested_at' => now(),
            'last_error' => $ok ? null : mb_substr($message, 0, 500),
        ]);

        return back()->with($ok ? 'success' : 'error', $message);
    }
}
