<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PrdAnalysis extends Model
{
    use HasFactory;

    public const STATUS_QUEUED = 'queued';

    public const STATUS_RUNNING = 'running';

    public const STATUS_COMPLETED = 'completed';

    public const STATUS_FAILED = 'failed';

    public const READY_SCORE = 70;

    protected $fillable = [
        'user_id', 'product_id', 'title', 'source_type', 'source_name', 'file_path', 'file_mime', 'source_text',
        'status', 'score', 'result', 'error', 'model', 'input_tokens', 'output_tokens', 'started_at', 'completed_at',
    ];

    // The raw document can be large and may contain sensitive business detail; load it only when analysing.
    protected $hidden = ['source_text', 'file_path'];

    protected function casts(): array
    {
        return [
            'result' => 'array',
            'score' => 'integer',
            'started_at' => 'datetime',
            'completed_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    public function flowRevisions(): HasMany
    {
        return $this->hasMany(PrdFlowRevision::class);
    }

    public function isFinished(): bool
    {
        return in_array($this->status, [self::STATUS_COMPLETED, self::STATUS_FAILED], true);
    }

    public function isReady(): bool
    {
        return $this->score !== null && $this->score >= self::READY_SCORE;
    }
}
