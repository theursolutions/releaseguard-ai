<?php

namespace App\Http\Controllers;

use App\Services\Crm\PerformanceData;
use App\Services\Platform\ServiceException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Sales and agent performance. Executives (ReleaseGuard admins) see every agency; agency owners and
 * admins see their agency; agents see themselves. The scope is decided by the performance service
 * from the viewer's live CRM role, never by the browser.
 */
class PerformanceController extends Controller
{
    public function index(Request $request, PerformanceData $performance): Response
    {
        $user = $request->user();

        return Inertia::render('performance/Index', [
            'viewer' => [
                'kind' => $user->isCrmUser() ? 'crm' : 'executive',
                'persona' => $user->crm_persona ?? 'executive',
                'agency' => $user->crm_agency_name,
                'name' => $user->name,
            ],
            'crmConnected' => $performance->connected(),
        ]);
    }

    public function data(Request $request, PerformanceData $performance): JsonResponse
    {
        $filters = $request->validate([
            'period' => ['nullable', 'in:7d,30d,90d,12m,all'],
            'agency_id' => ['nullable', 'integer', 'min:1'],
            'agent_user_id' => ['nullable', 'integer', 'min:1'],
        ]);

        try {
            return response()->json($performance->overview($request->user(), $filters));
        } catch (ServiceException $e) {
            return response()->json(['message' => $e->getMessage()], $e->status === 403 ? 403 : 502);
        }
    }
}
