<?php

namespace Tests\Feature\Portal;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;
use ZipArchive;

class ToolkitTest extends TestCase
{
    use RefreshDatabase;

    private User $member;

    protected function setUp(): void
    {
        parent::setUp();
        $this->member = User::factory()->create();
        config(['releaseguard.toolkit.path' => $this->makeToolkit(), 'releaseguard.toolkit.repo_url' => null]);
    }

    /** A small toolkit folder with the same layout and front matter as Module A. */
    private function makeToolkit(): string
    {
        $root = sys_get_temp_dir().'/rg-toolkit-'.uniqid();
        $files = [
            'install.js' => '// installer',
            'plugin/rules/core.md' => "# How to work in this repository\n",
            'plugin/rules/laravel.md' => "---\npaths:\n  - \"**/*.php\"\n---\n\n# Laravel\n",
            'plugin/skills/fix/SKILL.md' => "---\nname: fix\ndescription: Fix a Jira bug properly.\nargument-hint: <JIRA-KEY>\n---\n# Fix",
            // Internal skills that people can't type must not be listed as commands.
            'plugin/skills/pipeline/SKILL.md' => "---\nname: pipeline\ndescription: Internal.\nuser-invocable: false\n---\n",
            'plugin/agents/code-reviewer.md' => "---\nname: code-reviewer\ndescription: Strict senior code reviewer.\ntools: Read, Grep, Glob, Bash\n---\n",
            'plugin/agents/planner.md' => "---\nname: planner\ndescription: Technical planner.\ndisallowedTools: Edit, Write\n---\n",
            'plugin/agents/test-engineer.md' => "---\nname: test-engineer\ndescription: Writes tests.\ntools: Read, Edit, Write\n---\n",
            'plugin/hooks/guard-bash.js' => "#!/usr/bin/env node\n// PreToolUse hook for Bash: blocks commands that destroy data.\n",
            // Regression: a purpose wrapped over two comment lines was cut off at the first line.
            'plugin/hooks/protect-files.js' => "#!/usr/bin/env node\n// PreToolUse hook: stops Claude from changing secrets,\n// third-party code or output. Exit code 2 blocks it.\nconst path = require('path');\n// later comment\n",
            'plugin/.claude-plugin/plugin.json' => '{"name": "devcrew", "version": "1.0.0"}',
            'plugin/settings.local.json' => '{"personal": true}',
            'plugin/.mcp.json' => '{}',
            'node_modules/leftover/index.js' => '//',
            'docs/ONBOARDING.md' => "Intro\n# Claude Code onboarding\n",
        ];
        foreach ($files as $path => $content) {
            @mkdir(dirname("{$root}/{$path}"), 0777, true);
            file_put_contents("{$root}/{$path}", $content);
        }

        return $root;
    }

    public function test_guests_are_sent_to_login(): void
    {
        $this->get('/toolkit')->assertRedirect('/login');
        $this->get('/toolkit/download')->assertRedirect('/login');
    }

    public function test_page_lists_commands_agents_guards_rules_and_docs(): void
    {
        $this->actingAs($this->member)->get('/toolkit')
            ->assertOk()
            ->assertInertia(fn ($page) => $page->component('toolkit/Index')
                ->where('catalog.available', true)
                ->where('catalog.plugin', 'devcrew')
                ->where('catalog.version', '1.0.0')
                ->where('catalog.commands', [['name' => 'fix', 'description' => 'Fix a Jira bug properly.', 'arguments' => '<JIRA-KEY>']])
                ->where('catalog.agents.0', ['name' => 'code-reviewer', 'description' => 'Strict senior code reviewer.', 'read_only' => true])
                ->where('catalog.agents.1.read_only', true) // denies Edit explicitly
                ->where('catalog.agents.2.read_only', false) // may edit
                ->where('catalog.hooks', [
                    ['name' => 'guard-bash', 'description' => 'PreToolUse hook for Bash: blocks commands that destroy data.'],
                    ['name' => 'protect-files', 'description' => 'PreToolUse hook: stops Claude from changing secrets, third-party code or output.'],
                ])
                ->where('catalog.rules', [['name' => 'core', 'title' => 'How to work in this repository'], ['name' => 'laravel', 'title' => 'Laravel']])
                ->where('catalog.atlassian_mcp', true)
                ->where('catalog.docs', [['file' => 'ONBOARDING.md', 'title' => 'Claude Code onboarding']])
                ->where('folder', 'ai-dev-toolkit')
                ->where('repoUrl', null));
    }

    public function test_crm_users_can_open_the_page_too(): void
    {
        $crmUser = User::factory()->create(['crm_user_id' => 9862]);

        $this->actingAs($crmUser)->get('/toolkit')->assertOk()->assertInertia(fn ($page) => $page->component('toolkit/Index'));
    }

    public function test_git_clone_url_is_shared_when_configured(): void
    {
        config(['releaseguard.toolkit.repo_url' => 'https://git.example.test/ai-dev-toolkit.git']);

        $this->actingAs($this->member)->get('/toolkit')
            ->assertInertia(fn ($page) => $page->where('repoUrl', 'https://git.example.test/ai-dev-toolkit.git'));
    }

    public function test_download_is_a_zip_of_the_toolkit_without_personal_or_local_files(): void
    {
        $response = $this->actingAs($this->member)->get('/toolkit/download')->assertOk()->assertDownload('ai-dev-toolkit.zip');

        $zip = new ZipArchive;
        $this->assertTrue($zip->open($response->baseResponse->getFile()->getPathname()));
        $entries = collect(range(0, $zip->numFiles - 1))->map(fn (int $i) => $zip->getNameIndex($i));
        $zip->close();

        $this->assertContains('ai-dev-toolkit/install.js', $entries);
        $this->assertContains('ai-dev-toolkit/plugin/.claude-plugin/plugin.json', $entries);
        $this->assertContains('ai-dev-toolkit/plugin/.mcp.json', $entries);
        $this->assertContains('ai-dev-toolkit/docs/ONBOARDING.md', $entries);
        $this->assertNotContains('ai-dev-toolkit/plugin/settings.local.json', $entries);
        $this->assertEmpty($entries->filter(fn (string $entry) => str_contains($entry, 'node_modules')));
    }

    public function test_missing_toolkit_folder_shows_a_note_and_no_download(): void
    {
        config(['releaseguard.toolkit.path' => sys_get_temp_dir().'/rg-toolkit-missing-'.uniqid()]);

        $this->actingAs($this->member)->get('/toolkit')
            ->assertOk()
            ->assertInertia(fn ($page) => $page->where('catalog.available', false)->where('catalog.note', 'The toolkit folder is not available to the portal (set TOOLKIT_PATH).'));

        $this->actingAs($this->member)->get('/toolkit/download')->assertNotFound();
    }
}
