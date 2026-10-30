<?php

namespace App\Services\Toolkit;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;

/**
 * What Module A (the devcrew Claude Code plugin) contains, read from the toolkit's plugin folder.
 * The folder comes only from configuration, never from a request.
 */
class ToolkitInventory
{
    private const UNAVAILABLE = 'The toolkit folder is not available to the portal (set TOOLKIT_PATH).';

    /** @return array<string, mixed> */
    public function summary(): array
    {
        return Cache::remember('toolkit.inventory', (int) config('releaseguard.toolkit.cache_seconds'), fn () => $this->read());
    }

    /** @return array<string, mixed> */
    private function read(): array
    {
        $plugin = $this->pluginDir();
        if ($plugin === null) {
            return ['available' => false, 'note' => self::UNAVAILABLE];
        }

        $names = fn (string $pattern) => collect(glob($pattern) ?: [])->map(fn ($path) => pathinfo($path, PATHINFO_FILENAME))->sort()->values()->all();

        return [
            'available' => true,
            'rules' => $names("{$plugin}/rules/*.md"),
            'skills' => $this->commandFiles($plugin)->map(fn ($path) => basename(dirname($path)))->values()->all(),
            'agents' => $names("{$plugin}/agents/*.md"),
            'hooks' => $names("{$plugin}/hooks/*.js"),
            'atlassian_mcp' => is_file("{$plugin}/.mcp.json"),
            'docs' => collect(glob(dirname($plugin).'/docs/*.md') ?: [])->map(fn ($path) => [
                'file' => basename($path),
                'title' => $this->heading($path) ?? pathinfo($path, PATHINFO_FILENAME),
            ])->values()->all(),
        ];
    }

    /**
     * The full catalogue for the Toolkit page: every command, agent, rule and hook with its description.
     *
     * @return array<string, mixed>
     */
    public function catalog(): array
    {
        return Cache::remember('toolkit.catalog', (int) config('releaseguard.toolkit.cache_seconds'), fn () => $this->readCatalog());
    }

    /** @return array<string, mixed> */
    private function readCatalog(): array
    {
        $plugin = $this->pluginDir();
        if ($plugin === null) {
            return ['available' => false, 'note' => self::UNAVAILABLE];
        }

        $files = fn (string $pattern) => collect(glob($pattern) ?: [])->sort()->values();
        $manifest = json_decode((string) file_get_contents("{$plugin}/.claude-plugin/plugin.json"), true) ?: [];

        return [
            'available' => true,
            'plugin' => (string) ($manifest['name'] ?? 'devcrew'),
            'version' => (string) ($manifest['version'] ?? ''),
            'commands' => $this->commandFiles($plugin)->map(function (string $path) {
                $meta = $this->frontMatter($path);

                return [
                    'name' => $meta['name'] ?? basename(dirname($path)),
                    'description' => $meta['description'] ?? '',
                    'arguments' => $meta['argument-hint'] ?? null,
                ];
            })->all(),
            'agents' => $files("{$plugin}/agents/*.md")->map(function (string $path) {
                $meta = $this->frontMatter($path);
                $tools = array_map('trim', explode(',', $meta['tools'] ?? ''));
                $denied = array_map('trim', explode(',', $meta['disallowedTools'] ?? ''));

                return [
                    'name' => $meta['name'] ?? pathinfo($path, PATHINFO_FILENAME),
                    'description' => $meta['description'] ?? '',
                    // An agent is read-only when its tool list leaves out file editing, or explicitly denies it.
                    'read_only' => in_array('Edit', $denied, true) || (isset($meta['tools']) && ! in_array('Edit', $tools, true)),
                ];
            })->all(),
            'rules' => $files("{$plugin}/rules/*.md")->map(fn (string $path) => [
                'name' => pathinfo($path, PATHINFO_FILENAME),
                'title' => $this->heading($path) ?? pathinfo($path, PATHINFO_FILENAME),
            ])->all(),
            'hooks' => $files("{$plugin}/hooks/*.js")->map(fn (string $path) => [
                'name' => pathinfo($path, PATHINFO_FILENAME),
                'description' => $this->firstComment($path) ?? '',
            ])->all(),
            'atlassian_mcp' => is_file("{$plugin}/.mcp.json"),
            'docs' => $files(dirname($plugin).'/docs/*.md')->map(fn (string $path) => [
                'file' => basename($path),
                'title' => $this->heading($path) ?? pathinfo($path, PATHINFO_FILENAME),
            ])->all(),
        ];
    }

    private function pluginDir(): ?string
    {
        $plugin = rtrim((string) config('releaseguard.toolkit.path'), '/\\').'/plugin';

        return is_file("{$plugin}/.claude-plugin/plugin.json") ? $plugin : null;
    }

    /**
     * The commands people can type. Internal skills (user-invocable: false, like the crew pipeline) are left out.
     *
     * @return Collection<int, string>
     */
    private function commandFiles(string $plugin): Collection
    {
        return collect(glob("{$plugin}/skills/*/SKILL.md") ?: [])
            ->reject(fn (string $path) => ($this->frontMatter($path)['user-invocable'] ?? 'true') === 'false')
            ->sort()
            ->values();
    }

    /**
     * Reads the simple "key: value" lines of a Markdown front matter block. Values are single-line in
     * the toolkit, so a YAML parser is not needed; list items (e.g. "paths:") are ignored.
     *
     * @return array<string, string>
     */
    private function frontMatter(string $path): array
    {
        $lines = file($path, FILE_IGNORE_NEW_LINES) ?: [];
        if (trim($lines[0] ?? '') !== '---') {
            return [];
        }

        $meta = [];
        foreach (array_slice($lines, 1) as $line) {
            if (trim($line) === '---') {
                break;
            }
            if (preg_match('/^([A-Za-z][\w-]*):\s*(.+)$/', $line, $match)) {
                $meta[$match[1]] = trim($match[2], " \t\"'");
            }
        }

        return $meta;
    }

    /** The first sentence of a hook script's opening "//" comment block: its purpose. */
    private function firstComment(string $path): ?string
    {
        $comment = [];
        foreach (file($path, FILE_IGNORE_NEW_LINES) ?: [] as $line) {
            if (str_starts_with($line, '// ')) {
                $comment[] = trim(substr($line, 3));
            } elseif ($comment !== []) {
                break;
            }
        }
        if ($comment === []) {
            return null;
        }

        // The block can wrap a sentence over several lines and go on to explain exit codes; keep the purpose only.
        $text = implode(' ', $comment);

        return preg_match('/^.+?\.(?=\s|$)/', $text, $match) ? $match[0] : $text;
    }

    private function heading(string $path): ?string
    {
        $handle = fopen($path, 'r');
        try {
            while (($line = fgets($handle)) !== false) {
                if (str_starts_with($line, '# ')) {
                    return trim(substr($line, 2));
                }
            }
        } finally {
            fclose($handle);
        }

        return null;
    }
}
