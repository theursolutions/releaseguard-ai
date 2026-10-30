<?php

namespace App\Http\Controllers;

use App\Http\Requests\CorrectPrdFlowRequest;
use App\Models\PrdAnalysis;
use App\Services\Platform\ServiceException;
use App\Services\Prd\PrdFlows;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;

/** The flows of a PRD review as actor swimlanes, for the assistant's flow panel, and their corrected versions. */
class PrdFlowController extends Controller
{
    public function __construct(private readonly PrdFlows $flows) {}

    public function index(PrdAnalysis $analysis): JsonResponse
    {
        Gate::authorize('view', $analysis);
        $this->ensureCompleted($analysis);

        return response()->json([
            'review' => ['id' => $analysis->id, 'title' => $analysis->title],
            'flows' => $this->flows->list($analysis),
        ]);
    }

    public function show(Request $request, PrdAnalysis $analysis, string $flow): JsonResponse
    {
        Gate::authorize('view', $analysis);
        $this->ensureCompleted($analysis);

        return $this->flowResponse($request, $analysis, $this->flows->find($analysis, $flow));
    }

    public function correct(CorrectPrdFlowRequest $request, PrdAnalysis $analysis, string $flow): JsonResponse
    {
        $this->ensureCompleted($analysis);
        abort_unless($this->flows->find($analysis, $flow), 404, 'That flow is not in this review.');

        try {
            $data = $this->flows->correct($analysis, $flow, $request->validated('instruction'), $request->user());
        } catch (ServiceException $e) {
            // Nothing is saved; the message says what to do next.
            return response()->json(['message' => $e->getMessage()], $e->status === 422 ? 422 : 502);
        }

        return $this->flowResponse($request, $analysis, $data);
    }

    public function restore(Request $request, PrdAnalysis $analysis, string $flow, int $version): JsonResponse
    {
        Gate::authorize('update', $analysis);
        $this->ensureCompleted($analysis);
        abort_unless($this->flows->find($analysis, $flow), 404, 'That flow is not in this review.');

        $data = $this->flows->restore($analysis, $flow, $version, $request->user());
        abort_unless($data, 404, 'That version does not exist.');

        return $this->flowResponse($request, $analysis, $data);
    }

    private function ensureCompleted(PrdAnalysis $analysis): void
    {
        abort_unless($analysis->status === PrdAnalysis::STATUS_COMPLETED, 404, 'This review has no flows yet.');
    }

    /** @param array<string, mixed>|null $data */
    private function flowResponse(Request $request, PrdAnalysis $analysis, ?array $data): JsonResponse
    {
        abort_unless($data, 404, 'That flow is not in this review.');

        return response()->json($data + ['can_correct' => $request->user()->can('update', $analysis)]);
    }
}
