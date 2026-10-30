<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;
use Inertia\Inertia;
use Inertia\Response;

class UserController extends Controller
{
    public function index(): Response
    {
        return Inertia::render('users/Index', [
            'users' => User::query()->orderBy('name')->get(['id', 'name', 'email', 'role', 'created_at']),
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'role' => ['required', Rule::in(User::ROLES)],
            'password' => ['required', Password::defaults()],
        ]);

        $user = User::create(['name' => $data['name'], 'email' => $data['email'], 'password' => $data['password']]);
        $user->forceFill(['role' => $data['role'], 'email_verified_at' => now()])->save();

        return back()->with('success', "{$user->name} can now sign in. Share the temporary password privately and ask them to change it under Settings.");
    }

    public function update(Request $request, User $user): RedirectResponse
    {
        $data = $request->validate(['role' => ['required', Rule::in(User::ROLES)]]);

        if ($user->isAdmin() && $data['role'] !== User::ROLE_ADMIN && $this->isLastAdmin($user)) {
            return back()->with('error', 'There must always be at least one admin.');
        }

        $user->forceFill(['role' => $data['role']])->save();

        return back()->with('success', "{$user->name} is now {$data['role']}.");
    }

    public function destroy(Request $request, User $user): RedirectResponse
    {
        if ($user->is($request->user())) {
            return back()->with('error', 'You cannot remove your own account here.');
        }
        if ($user->isAdmin() && $this->isLastAdmin($user)) {
            return back()->with('error', 'There must always be at least one admin.');
        }

        $user->delete();

        return back()->with('success', "{$user->name} was removed.");
    }

    private function isLastAdmin(User $user): bool
    {
        return User::query()->where('role', User::ROLE_ADMIN)->whereKeyNot($user->id)->doesntExist();
    }
}
