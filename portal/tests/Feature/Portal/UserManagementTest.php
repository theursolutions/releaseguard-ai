<?php

namespace Tests\Feature\Portal;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class UserManagementTest extends TestCase
{
    use RefreshDatabase;

    public function test_admin_adds_a_user_with_a_role(): void
    {
        $admin = User::factory()->admin()->create();

        $this->actingAs($admin)->post('/users', ['name' => 'Aisha', 'email' => 'aisha@example.com', 'role' => 'member', 'password' => 'temporary-pass-1'])
            ->assertSessionHasNoErrors();

        $user = User::query()->where('email', 'aisha@example.com')->sole();
        $this->assertSame('member', $user->role);
        $this->assertTrue(Hash::check('temporary-pass-1', $user->password));
        $this->assertNotNull($user->email_verified_at);
    }

    public function test_the_last_admin_cannot_be_demoted_or_removed(): void
    {
        $admin = User::factory()->admin()->create();
        $other = User::factory()->create();

        $this->actingAs($admin)->patch("/users/{$admin->id}", ['role' => 'member'])->assertSessionHas('error');
        $this->assertSame('admin', $admin->fresh()->role);

        $this->actingAs($admin)->delete("/users/{$admin->id}")->assertSessionHas('error');
        $this->assertModelExists($admin);

        $this->actingAs($admin)->patch("/users/{$other->id}", ['role' => 'admin'])->assertSessionHas('success');
        $this->actingAs($admin)->patch("/users/{$admin->id}", ['role' => 'member'])->assertSessionHas('success');
    }

    public function test_invalid_roles_are_rejected(): void
    {
        $admin = User::factory()->admin()->create();
        $user = User::factory()->create();

        $this->actingAs($admin)->patch("/users/{$user->id}", ['role' => 'superuser'])->assertSessionHasErrors('role');
    }

    public function test_make_admin_command_promotes_an_existing_user(): void
    {
        $user = User::factory()->create(['email' => 'lead@example.com']);

        $this->artisan('portal:make-admin', ['email' => 'lead@example.com'])->assertSuccessful();

        $this->assertSame('admin', $user->fresh()->role);
    }

    public function test_make_admin_command_creates_a_new_admin(): void
    {
        $this->artisan('portal:make-admin', ['email' => 'new@example.com', '--name' => 'New Admin'])
            ->expectsQuestion('Password (min. 8 characters)', 'strong-password-1')
            ->assertSuccessful();

        $this->assertSame('admin', User::query()->where('email', 'new@example.com')->value('role'));
    }
}
