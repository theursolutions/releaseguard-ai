<?php

namespace Tests\Feature\Portal;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class AccessControlTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Http::fake(['*' => Http::response(['status' => 'ok'])]);
    }

    public function test_guests_are_sent_to_login(): void
    {
        foreach (['/dashboard', '/prd', '/monitoring', '/connections', '/users', '/services'] as $url) {
            $this->get($url)->assertRedirect('/login');
        }
    }

    public function test_public_registration_is_disabled(): void
    {
        $this->get('/register')->assertNotFound();
        $this->post('/register', ['name' => 'x', 'email' => 'x@example.com', 'password' => 'password', 'password_confirmation' => 'password'])->assertNotFound();
    }

    public function test_members_use_the_tools_but_not_admin_pages(): void
    {
        $member = User::factory()->create();

        $this->actingAs($member)->get('/dashboard')->assertOk();
        $this->actingAs($member)->get('/prd')->assertOk();

        foreach (['/connections', '/services', '/users'] as $url) {
            $this->actingAs($member)->get($url)->assertForbidden();
        }
        $this->actingAs($member)->put('/connections/anthropic', ['api_key' => 'sk-ant-test-1234567890'])->assertForbidden();
        $this->actingAs($member)->post('/users', ['name' => 'Eve', 'email' => 'eve@example.com', 'role' => 'admin', 'password' => 'password'])->assertForbidden();
    }

    public function test_admins_can_open_admin_pages(): void
    {
        $admin = User::factory()->admin()->create();

        foreach (['/connections', '/services', '/users'] as $url) {
            $this->actingAs($admin)->get($url)->assertOk();
        }
    }

    public function test_role_cannot_be_set_through_the_profile_form(): void
    {
        $member = User::factory()->create();

        $this->actingAs($member)->patch('/settings/profile', ['name' => 'Mallory', 'email' => $member->email, 'role' => 'admin']);

        $this->assertSame('member', $member->fresh()->role);
    }

    public function test_shared_user_data_does_not_leak_sensitive_fields(): void
    {
        $member = User::factory()->create();

        $this->actingAs($member)->get('/dashboard')->assertInertia(fn ($page) => $page
            ->where('auth.isAdmin', false)
            ->where('auth.user.role', 'member')
            ->missing('auth.user.password')
            ->missing('auth.user.remember_token'));
    }
}
