<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PrdFlowRevision extends Model
{
    protected $fillable = ['prd_analysis_id', 'flow_id', 'version', 'flow', 'instruction', 'change_summary', 'restored_from_version', 'user_id', 'model'];

    protected function casts(): array
    {
        return [
            'flow' => 'array',
            'version' => 'integer',
            'restored_from_version' => 'integer',
        ];
    }

    public function analysis(): BelongsTo
    {
        return $this->belongsTo(PrdAnalysis::class, 'prd_analysis_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
