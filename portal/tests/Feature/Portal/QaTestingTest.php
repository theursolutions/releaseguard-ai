<?php

namespace Tests\Feature\Portal;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class QaTestingTest extends TestCase
{
    use RefreshDatabase;

    private User $member;

    protected function setUp(): void
    {
        parent::setUp();
        $this->member = User::factory()->create();
        config(['releaseguard.toolkit.path' => $this->makeToolkit(), 'releaseguard.toolkit.repo_url' => null]);
    }

    /** Just enough of Module A for the inventory to find the plugin and its version. */
    private function makeToolkit(): string
    {
        $root = sys_get_temp_dir().'/rg-qa-toolkit-'.uniqid();
        @mkdir("{$root}/plugin/.claude-plugin", 0777, true);
        file_put_contents("{$root}/plugin/.claude-plugin/plugin.json", '{"name": "devcrew", "version": "1.2.0"}');

        return $root;
    }

    public function test_guests_are_sent_to_login(): void
    {
        $this->get('/qa-testing')->assertRedirect('/login');
    }

    public function test_page_gets_the_toolkit_summary_without_the_full_catalog(): void
    {
        $this->actingAs($this->member)->get('/qa-testing')
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component('qa-testing/Index')
                ->where('toolkit', ['available' => true, 'plugin' => 'devcrew', 'version' => '1.2.0'])
                ->where('folder', 'ai-dev-toolkit')
                ->where('repoUrl', null));
    }

    public function test_crm_users_can_open_the_page_too(): void
    {
        $crmUser = User::factory()->create(['crm_user_id' => 9862]);

        $this->actingAs($crmUser)->get('/qa-testing')->assertOk()->assertInertia(fn ($page) => $page->component('qa-testing/Index'));
    }

    public function test_git_clone_url_is_shared_when_configured(): void
    {
        config(['releaseguard.toolkit.repo_url' => 'https://git.example.test/ai-dev-toolkit.git']);

        $this->actingAs($this->member)->get('/qa-testing')
            ->assertInertia(fn ($page) => $page->where('repoUrl', 'https://git.example.test/ai-dev-toolkit.git'));
    }

    public function test_missing_toolkit_folder_shows_a_note(): void
    {
        config(['releaseguard.toolkit.path' => sys_get_temp_dir().'/rg-qa-toolkit-missing-'.uniqid()]);

        $this->actingAs($this->member)->get('/qa-testing')
            ->assertOk()
            ->assertInertia(fn ($page) => $page->where('toolkit', [
                'available' => false,
                'note' => 'The toolkit folder is not available to the portal (set TOOLKIT_PATH).',
            ]));
    }
}
