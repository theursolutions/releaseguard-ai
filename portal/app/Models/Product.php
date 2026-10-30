<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Product extends Model
{
    protected $fillable = ['name', 'slug', 'description', 'alarm_prefix'];

    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class);
    }

    /** Whether a monitoring alarm (by name) belongs to this product. No prefix = no alarms. */
    public function ownsAlarm(string $alarmName): bool
    {
        return filled($this->alarm_prefix) && str_starts_with($alarmName, $this->alarm_prefix);
    }
}
