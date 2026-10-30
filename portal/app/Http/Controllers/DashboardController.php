<?php

namespace App\Http\Controllers;

use App\Enums\ConnectionType;
use App\Models\AlarmDiagnosis;
use App\Models\Connection;
use App\Models\PrdAnalysis;
use App\Services\Monitoring\MonitoringOverview;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class DashboardController extends Controller
{
    public function index(Request $request, MonitoringOverview $monitoring): Response
    {
        $overview = $monitoring->fetch()['data'];

        $completed = PrdAnalysis::query()->where('status', PrdAnalysis::STATUS_COMPLETED);
        $readyScore = config('releaseguard.prd.ready_score');

        return Inertia::render('Dashboard', [
            'prd' => [
                'total' => PrdAnalysis::query()->count(),
                'average_score' => (int) round((float) (clone $completed)->latest()->limit(20)->pluck('score')->avg()),
                'ready' => (clone $completed)->where('score', '>=', $readyScore)->count(),
                'not_ready' => (clone $completed)->where('score', '<', $readyScore)->count(),
                'recent' => PrdAnalysis::query()->latest()->limit(5)->get(['id', 'title', 'status', 'score', 'created_at']),
                // Oldest first, for the readiness trend line.
                'scores' => (clone $completed)->latest()->limit(20)->get(['score', 'created_at'])->reverse()->values(),
            ],
            'monitoring' => [
                'diagnoses' => AlarmDiagnosis::query()->count(),
                'recent' => AlarmDiagnosis::query()->latest()->limit(3)->get(['id', 'alarm_name', 'status', 'is_demo', 'created_at']),
                'available' => $overview !== null,
                'demo' => (bool) ($overview['demo'] ?? false),
                'counts' => $overview['counts'] ?? null,
                'alarms' => collect($overview['alarms'] ?? [])->where('state', 'ALARM')->take(4)->map(fn ($a) => collect($a)->only(['name', 'severity', 'resource']))->values(),
            ],
            'showBusiness' => $request->user()->canSeePerformance(),
            'connections' => collect(ConnectionType::cases())->map(fn (ConnectionType $type) => [
                'type' => $type->value,
                'label' => $type->label(),
                'status' => Connection::for($type)?->status ?? 'not_configured',
            ])->values(),
            'readyScore' => $readyScore,
        ]);
    }
}
