<?php

namespace App\Http\Controllers;

use App\Services\Toolkit\ToolkitInventory;
use App\Services\Toolkit\ToolkitPackage;
use Illuminate\Support\Arr;
use Inertia\Inertia;
use Inertia\Response;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class ToolkitController extends Controller
{
    public function index(ToolkitInventory $toolkit): Response
    {
        return Inertia::render('toolkit/Index', [
            'catalog' => $toolkit->catalog(),
            'folder' => ToolkitPackage::FOLDER,
            'repoUrl' => config('releaseguard.toolkit.repo_url') ?: null,
        ]);
    }

    /** The QA Testing page explains devcrew's QA test cycles; tests still run on each person's own computer. */
    public function qa(ToolkitInventory $toolkit): Response
    {
        return Inertia::render('qa-testing/Index', [
            'toolkit' => Arr::only($toolkit->catalog(), ['available', 'note', 'plugin', 'version']),
            'folder' => ToolkitPackage::FOLDER,
            'repoUrl' => config('releaseguard.toolkit.repo_url') ?: null,
        ]);
    }

    public function download(ToolkitPackage $package): BinaryFileResponse
    {
        abort_unless($package->available(), 404, 'The toolkit is not available on this server.');

        return response()->download($package->build(), ToolkitPackage::FOLDER.'.zip', ['Content-Type' => 'application/zip'])
            ->deleteFileAfterSend();
    }
}
