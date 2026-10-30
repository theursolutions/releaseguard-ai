<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AssistantMessage extends Model
{
    protected $fillable = ['conversation_id', 'role', 'content', 'tools', 'status', 'model'];

    protected function casts(): array
    {
        return ['tools' => 'array'];
    }

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(AssistantConversation::class, 'conversation_id');
    }
}
