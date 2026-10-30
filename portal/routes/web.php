<?php

use App\Enums\ConnectionType;
use App\Http\Controllers\AssistantController;
use App\Http\Controllers\ConnectionController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\Internal\AssistantToolController;
use App\Http\Controllers\MonitoringController;
use App\Http\Controllers\PerformanceController;
use App\Http\Controllers\PrdAnalysisController;
use App\Http\Controllers\PrdFlowController;
use App\Http\Controllers\ProductController;
use App\Http\Controllers\ServiceController;
use App\Http\Controllers\ToolkitController;
use App\Http\Controllers\UserController;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Support\Facades\Route;

// The voice workspace is the home screen.
Route::redirect('/', '/assistant')->name('home');

Route::middleware(['auth', 'verified'])->group(function () {
    Route::prefix('assistant')->name('assistant.')->group(function () {
        Route::get('/', [AssistantController::class, 'index'])->name('index');
        Route::get('status', [AssistantController::class, 'status'])->middleware('throttle:30,1')->name('status');
        // The command-centre widgets poll this every 15 seconds while the page is visible.
        Route::get('live', [AssistantController::class, 'live'])->middleware('throttle:60,1')->name('live');
        Route::get('prd-reviews', [AssistantController::class, 'prdReviews'])->middleware('can:engineering')->name('prd-reviews');
        // Each message calls Claude, so limit how fast one person can send them.
        Route::post('chat', [AssistantController::class, 'chat'])->middleware('throttle:20,1')->name('chat');
        Route::get('conversations/{conversation}', [AssistantController::class, 'conversation'])->name('conversations.show');
        Route::delete('conversations/{conversation}', [AssistantController::class, 'destroyConversation'])->name('conversations.destroy');
    });

    Route::get('toolkit', [ToolkitController::class, 'index'])->name('toolkit.index');
    // Each download packs the toolkit folder into a fresh zip, so limit how often one person can ask.
    Route::get('toolkit/download', [ToolkitController::class, 'download'])->middleware('throttle:10,1')->name('toolkit.download');
    Route::get('qa-testing', [ToolkitController::class, 'qa'])->name('qa-testing.index');

    Route::middleware('can:performance')->group(function () {
        Route::get('performance', [PerformanceController::class, 'index'])->name('performance.index');
        Route::get('performance/data', [PerformanceController::class, 'data'])->middleware('throttle:60,1')->name('performance.data');
    });

    Route::middleware('can:engineering')->group(function () {
        Route::get('dashboard', [DashboardController::class, 'index'])->name('dashboard');

        Route::prefix('prd')->name('prd.')->group(function () {
            Route::get('/', [PrdAnalysisController::class, 'index'])->name('index');
            // Each analysis calls Claude, so limit how fast one person can start them.
            Route::post('/', [PrdAnalysisController::class, 'store'])->middleware('throttle:10,1')->name('store');
            Route::get('{analysis}', [PrdAnalysisController::class, 'show'])->name('show');
            Route::post('{analysis}/rerun', [PrdAnalysisController::class, 'rerun'])->middleware('throttle:10,1')->name('rerun');
            Route::get('{analysis}/export', [PrdAnalysisController::class, 'export'])->name('export');
            Route::delete('{analysis}', [PrdAnalysisController::class, 'destroy'])->name('destroy');

            Route::prefix('{analysis}/flows')->name('flows.')->where(['flow' => '[A-Za-z0-9._-]{1,60}'])->group(function () {
                Route::get('/', [PrdFlowController::class, 'index'])->name('index');
                Route::get('{flow}', [PrdFlowController::class, 'show'])->name('show');
                // Each correction calls the AI, so limit how fast one person can send them.
                Route::post('{flow}/corrections', [PrdFlowController::class, 'correct'])->middleware('throttle:10,1')->name('correct');
                Route::post('{flow}/restore/{version}', [PrdFlowController::class, 'restore'])->whereNumber('version')->name('restore');
            });
        });

        Route::get('monitoring', [MonitoringController::class, 'index'])->name('monitoring.index');
        Route::post('monitoring/diagnoses', [MonitoringController::class, 'diagnose'])->middleware('throttle:10,1')->name('monitoring.diagnose');
    });

    Route::middleware('can:admin')->group(function () {
        Route::get('connections', [ConnectionController::class, 'index'])->name('connections.index');
        Route::put('connections/{type}', [ConnectionController::class, 'update'])->whereIn('type', array_column(ConnectionType::cases(), 'value'))->name('connections.update');
        Route::post('connections/{type}/test', [ConnectionController::class, 'test'])->whereIn('type', array_column(ConnectionType::cases(), 'value'))->middleware('throttle:20,1')->name('connections.test');

        Route::get('services', [ServiceController::class, 'index'])->name('services.index');

        Route::get('products', [ProductController::class, 'index'])->name('products.index');
        Route::post('products', [ProductController::class, 'store'])->name('products.store');
        Route::put('products/{product}', [ProductController::class, 'update'])->name('products.update');
        Route::delete('products/{product}', [ProductController::class, 'destroy'])->name('products.destroy');

        Route::get('users', [UserController::class, 'index'])->name('users.index');
        Route::post('users', [UserController::class, 'store'])->name('users.store');
        Route::patch('users/{user}', [UserController::class, 'update'])->name('users.update');
        Route::delete('users/{user}', [UserController::class, 'destroy'])->name('users.destroy');
    });
});

// Machine-to-machine: the assistant service fetching business data. Authenticated by the service
// token + signed user context (see AssistantToolController), so no session or CSRF token applies.
Route::post('internal/assistant/tools/{tool}', AssistantToolController::class)
    ->withoutMiddleware([ValidateCsrfToken::class])
    ->middleware('throttle:120,1')
    ->name('internal.assistant.tools');

require __DIR__.'/settings.php';
require __DIR__.'/auth.php';
