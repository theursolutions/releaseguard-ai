<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AlarmDiagnosis extends Model
{
    protected $fillable = ['user_id', 'alarm_name', 'alarm', 'is_demo', 'status', 'result', 'error', 'model', 'completed_at'];

    protected function casts(): array
    {
        return [
            'alarm' => 'array',
            'result' => 'array',
            'is_demo' => 'boolean',
            'completed_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function isFinished(): bool
    {
        return in_array($this->status, [PrdAnalysis::STATUS_COMPLETED, PrdAnalysis::STATUS_FAILED], true);
    }
}
