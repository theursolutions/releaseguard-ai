<?php

namespace App\Http\Controllers;

use App\Enums\ConnectionType;
use App\Http\Requests\StorePrdAnalysisRequest;
use App\Jobs\RunPrdAnalysis;
use App\Models\Connection;
use App\Models\PrdAnalysis;
use App\Services\Platform\AiProviderResolver;
use App\Services\Prd\PrdFlows;
use App\Services\Prd\PrdMarkdownExporter;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

class PrdAnalysisController extends Controller
{
    public function index(): Response
    {
        $analyses = PrdAnalysis::query()
            ->with('user:id,name')
            ->latest()
            ->paginate(15, ['id', 'user_id', 'title', 'source_type', 'source_name', 'status', 'score', 'error', 'created_at', 'completed_at']);

        return Inertia::render('prd/Index', [
            'analyses' => $analyses,
            'aiConnected' => app(AiProviderResolver::class)->active() !== null,
            'confluenceConnected' => (bool) Connection::for(ConnectionType::Atlassian)?->isComplete(),
            'readyScore' => config('releaseguard.prd.ready_score'),
            'products' => fn () => request()->user()->authorizedProducts()->map->only(['id', 'name'])->values(),
        ]);
    }

    public function store(StorePrdAnalysisRequest $request): RedirectResponse
    {
        $data = $request->validated() + ['title' => null];
        $attributes = ['user_id' => $request->user()->id, 'product_id' => $data['product_id'] ?? null, 'source_type' => $data['source_type'], 'status' => PrdAnalysis::STATUS_QUEUED];

        if ($data['source_type'] === 'upload') {
            $file = $request->file('file');
            $attributes += [
                'title' => $data['title'] ?: pathinfo($file->getClientOriginalName(), PATHINFO_FILENAME),
                'source_name' => Str::limit($file->getClientOriginalName(), 250),
                // Stored privately under a random name: the client file name is never used as a path.
                'file_path' => $file->store('prd-uploads', 'local'),
                'file_mime' => match ($file->guessExtension()) {
                    'pdf' => 'application/pdf',
                    'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    default => 'text/plain',
                },
            ];
        } elseif ($data['source_type'] === 'confluence') {
            $attributes += ['title' => $data['title'] ?: 'Confluence PRD', 'source_name' => $data['url']];
        } else {
            $attributes += ['title' => $data['title'] ?: 'Pasted PRD', 'source_text' => $data['text']];
        }

        $analysis = PrdAnalysis::create($attributes);
        RunPrdAnalysis::dispatch($analysis->id);

        return to_route('prd.show', $analysis);
    }

    public function show(PrdAnalysis $analysis, PrdFlows $flows): Response
    {
        return Inertia::render('prd/Show', [
            'analysis' => $analysis->load('user:id,name'),
            // Drawn at their latest version, so corrections made in the flow panel show here too.
            'flows' => $analysis->status === PrdAnalysis::STATUS_COMPLETED ? $flows->all($analysis) : [],
            'readyScore' => config('releaseguard.prd.ready_score'),
            'canDelete' => Gate::allows('delete', $analysis),
        ]);
    }

    public function rerun(PrdAnalysis $analysis): RedirectResponse
    {
        Gate::authorize('update', $analysis);

        $analysis->update(['status' => PrdAnalysis::STATUS_QUEUED, 'error' => null, 'result' => null, 'score' => null, 'started_at' => null, 'completed_at' => null]);
        RunPrdAnalysis::dispatch($analysis->id);

        return to_route('prd.show', $analysis);
    }

    public function export(PrdAnalysis $analysis, PrdMarkdownExporter $exporter): StreamedResponse
    {
        abort_unless($analysis->status === PrdAnalysis::STATUS_COMPLETED, 404);

        return response()->streamDownload(
            fn () => print ($exporter->export($analysis)),
            Str::slug($analysis->title).'-prd-review.md',
            ['Content-Type' => 'text/markdown; charset=UTF-8'],
        );
    }

    public function destroy(Request $request, PrdAnalysis $analysis): RedirectResponse
    {
        Gate::authorize('delete', $analysis);

        if ($analysis->file_path) {
            Storage::disk('local')->delete($analysis->file_path);
        }
        $analysis->delete();

        return to_route('prd.index')->with('success', 'Analysis deleted.');
    }
}
