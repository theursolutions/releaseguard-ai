<?php

namespace App\Http\Controllers;

use App\Models\Product;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Inertia\Inertia;
use Inertia\Response;

/** Admin-only: the company products people can be authorised for. */
class ProductController extends Controller
{
    public function index(): Response
    {
        return Inertia::render('products/Index', [
            'products' => Product::query()->with('users:id')->orderBy('name')->get()->map(fn (Product $p) => [
                ...$p->only(['id', 'name', 'description', 'alarm_prefix']),
                'user_ids' => $p->users->pluck('id'),
            ]),
            'users' => User::query()->orderBy('name')->get(['id', 'name', 'email', 'role']),
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $data = $this->validated($request);
        $product = Product::create([...$data, 'slug' => $this->uniqueSlug($data['name'])]);
        $product->users()->sync($request->input('user_ids', []));

        return back()->with('success', "{$product->name} added.");
    }

    public function update(Request $request, Product $product): RedirectResponse
    {
        $product->update($this->validated($request, $product));
        $product->users()->sync($request->input('user_ids', []));

        return back()->with('success', "{$product->name} updated.");
    }

    public function destroy(Product $product): RedirectResponse
    {
        $product->delete();

        return back()->with('success', "{$product->name} removed. Its PRD reviews are kept without a product.");
    }

    /** @return array<string, mixed> */
    private function validated(Request $request, ?Product $product = null): array
    {
        return $request->validate([
            'name' => ['required', 'string', 'max:100', Rule::unique('products', 'name')->ignore($product)],
            'description' => ['nullable', 'string', 'max:255'],
            'alarm_prefix' => ['nullable', 'string', 'max:100', 'regex:/^[A-Za-z0-9._-]+$/'],
            'user_ids' => ['array'],
            'user_ids.*' => ['integer', 'exists:users,id'],
        ], ['alarm_prefix.regex' => 'Use letters, numbers, dots, dashes or underscores, e.g. production-crm-']);
    }

    private function uniqueSlug(string $name): string
    {
        $base = Str::slug($name) ?: 'product';
        $slug = $base;
        for ($i = 2; Product::query()->where('slug', $slug)->exists(); $i++) {
            $slug = "{$base}-{$i}";
        }

        return $slug;
    }
}
