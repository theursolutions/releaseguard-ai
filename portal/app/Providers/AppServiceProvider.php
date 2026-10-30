<?php

namespace App\Providers;

use App\Models\User;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        Gate::define('admin', fn (User $user) => $user->isAdmin());
        Gate::define('performance', fn (User $user) => $user->canSeePerformance());
        // Engineering tools (PRD checker, monitoring, product dashboard) are for the ReleaseGuard team,
        // not for agency owners and agents who sign in with their CRM account.
        Gate::define('engineering', fn (User $user) => ! $user->isCrmUser());
    }
}
