<?php

namespace App\Services\Connections;

use App\Enums\ConnectionType;
use App\Models\Connection;
use App\Models\User;

class ConnectionStore
{
    /**
     * Saves connection settings. A blank secret field keeps the stored value, so admins can change
     * the model or region without re-entering keys they can no longer see.
     *
     * @param  array<string, mixed>  $input
     */
    public function save(ConnectionType $type, array $input, User $user): Connection
    {
        $connection = Connection::for($type) ?? new Connection(['type' => $type]);
        $current = $connection->exists ? ($connection->settings ?? []) : [];

        $settings = [];
        foreach ($type->fields() as $key => $field) {
            $value = isset($input[$key]) ? trim((string) $input[$key]) : '';
            $settings[$key] = ($field['secret'] && $value === '') ? ($current[$key] ?? '') : $value;
        }

        if ($type === ConnectionType::Atlassian && $settings['site_url'] !== '') {
            $settings['site_url'] = rtrim($settings['site_url'], '/');
        }
        if ($type === ConnectionType::OpenAiCompatible && $settings['base_url'] !== '') {
            $settings['base_url'] = rtrim($settings['base_url'], '/');
        }

        $connection->fill([
            'settings' => $settings,
            'status' => 'untested',
            'last_error' => null,
            'updated_by' => $user->id,
        ])->save();

        return $connection;
    }

    /**
     * What the browser may see: non-secret values, and for secrets only whether one is saved
     * plus its last four characters.
     *
     * @return array<string, array<string, mixed>>
     */
    public function present(): array
    {
        $connections = Connection::query()->get()->keyBy(fn (Connection $c) => $c->type->value);

        $result = [];
        foreach (ConnectionType::cases() as $type) {
            $connection = $connections->get($type->value);
            $fields = [];
            foreach ($type->fields() as $key => $field) {
                $value = $connection?->setting($key);
                $fields[$key] = $field + [
                    'value' => $field['secret'] ? '' : (string) ($value ?? ''),
                    'is_set' => filled($value),
                    'hint' => $field['secret'] && filled($value) ? '••••'.substr((string) $value, -4) : null,
                ];
            }

            $result[$type->value] = [
                'type' => $type->value,
                'label' => $type->label(),
                'description' => $type->description(),
                'fields' => $fields,
                'configured' => (bool) $connection?->isComplete(),
                'status' => $connection->status ?? 'not_configured',
                'last_tested_at' => $connection?->last_tested_at?->toIso8601String(),
                'last_error' => $connection?->last_error,
            ];
        }

        return $result;
    }
}
