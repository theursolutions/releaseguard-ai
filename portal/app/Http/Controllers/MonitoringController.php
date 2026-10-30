<?php

namespace App\Http\Controllers;

use App\Jobs\RunAlarmDiagnosis;
use App\Models\AlarmDiagnosis;
use App\Models\PrdAnalysis;
use App\Services\Monitoring\MonitoringOverview;
use App\Services\Platform\AiProviderResolver;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class MonitoringController extends Controller
{
    // The live page refreshes every 10 seconds; CloudWatch itself reports at 1-minute resolution.
    private const REFRESH_SECONDS = 10;

    public function index(Request $request, MonitoringOverview $overview): Response
    {
        // Closures are only evaluated when requested, so polling a running diagnosis
        // (partial reload of "selected"/"diagnoses") does not call the monitoring service again.
        return Inertia::render('monitoring/Index', [
            'overview' => fn () => $overview->fetch(),
            'refreshSeconds' => self::REFRESH_SECONDS,
            'aiConnected' => fn () => app(AiProviderResolver::class)->active() !== null,
            'diagnoses' => fn () => AlarmDiagnosis::query()->with('user:id,name')->latest()->limit(10)->get(),
            'selected' => fn () => $request->integer('diagnosis')
                ? AlarmDiagnosis::query()->with('user:id,name')->find($request->integer('diagnosis'))
                : null,
        ]);
    }

    public function diagnose(Request $request): RedirectResponse
    {
        $data = $request->validate([
            'alarm_name' => ['required', 'string', 'max:255'],
            'alarm' => ['required', 'array'],
            'alarm.state' => ['required', 'string', 'max:30'],
        ]);

        $diagnosis = AlarmDiagnosis::create([
            'user_id' => $request->user()->id,
            'alarm_name' => $data['alarm_name'],
            'alarm' => collect($data['alarm'])->only(['name', 'state', 'severity', 'resource', 'metric', 'reason', 'updated_at'])->all(),
            'status' => PrdAnalysis::STATUS_QUEUED,
        ]);
        RunAlarmDiagnosis::dispatch($diagnosis->id);

        return to_route('monitoring.index', ['diagnosis' => $diagnosis->id]);
    }
}
