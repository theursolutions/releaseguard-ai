<?php

namespace App\Models;

use App\Enums\ConnectionType;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Connection extends Model
{
    protected $fillable = ['type', 'settings', 'status', 'last_tested_at', 'last_error', 'updated_by'];

    // Settings hold API keys and tokens: never serialise them.
    protected $hidden = ['settings'];

    protected function casts(): array
    {
        return [
            'type' => ConnectionType::class,
            'settings' => 'encrypted:array',
            'last_tested_at' => 'datetime',
        ];
    }

    public function updatedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }

    public static function for(ConnectionType $type): ?self
    {
        return static::query()->where('type', $type->value)->first();
    }

    public function setting(string $key, mixed $default = null): mixed
    {
        $value = $this->settings[$key] ?? null;

        return $value === null || $value === '' ? $default : $value;
    }

    public function isComplete(): bool
    {
        foreach ($this->type->requiredFields($this->settings ?? []) as $field) {
            if (blank($this->setting($field))) {
                return false;
            }
        }

        return true;
    }
}
