<?php

namespace App\Services\Toolkit;

use FilesystemIterator;
use RecursiveCallbackFilterIterator;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;
use RuntimeException;
use SplFileInfo;
use ZipArchive;

/**
 * Packs Module A (the Claude Code toolkit) into a zip so developers can install it without git access.
 * The folder comes only from configuration, never from a request.
 */
class ToolkitPackage
{
    public const FOLDER = 'ai-dev-toolkit';

    /** Same exclusions as the toolkit's .gitignore: personal settings and local clutter never ship. */
    private const EXCLUDED_NAMES = ['node_modules', 'settings.local.json', '.DS_Store', 'Thumbs.db'];

    public function available(): bool
    {
        return is_file($this->root().'/plugin/.claude-plugin/plugin.json');
    }

    /** Builds the zip in a temporary file and returns its path; the caller deletes it after sending. */
    public function build(): string
    {
        if (! $this->available()) {
            throw new RuntimeException('The toolkit folder is not available to the portal (set TOOLKIT_PATH).');
        }

        $zipPath = tempnam(sys_get_temp_dir(), 'toolkit-');
        $zip = new ZipArchive;
        if ($zip->open($zipPath, ZipArchive::OVERWRITE) !== true) {
            throw new RuntimeException('Could not create the toolkit zip.');
        }

        $root = $this->root();
        foreach ($this->files($root) as $file) {
            $relative = str_replace('\\', '/', substr($file->getPathname(), strlen($root) + 1));
            $zip->addFile($file->getPathname(), self::FOLDER.'/'.$relative);
        }
        $zip->close();

        return $zipPath;
    }

    /** @return iterable<SplFileInfo> */
    private function files(string $root): iterable
    {
        $directory = new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS);
        $filtered = new RecursiveCallbackFilterIterator($directory, function (SplFileInfo $file) {
            // Symbolic links could point outside the toolkit, so they are never followed or packed.
            return ! $file->isLink() && ! in_array($file->getFilename(), self::EXCLUDED_NAMES, true);
        });

        foreach (new RecursiveIteratorIterator($filtered) as $file) {
            if ($file->isFile()) {
                yield $file;
            }
        }
    }

    private function root(): string
    {
        return rtrim((string) config('releaseguard.toolkit.path'), '/\\');
    }
}
