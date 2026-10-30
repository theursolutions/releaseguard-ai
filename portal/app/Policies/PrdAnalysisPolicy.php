<?php

namespace App\Policies;

use App\Models\PrdAnalysis;
use App\Models\User;

/** Everyone on the team can read reviews; only the author or an admin can re-run or delete one. */
class PrdAnalysisPolicy
{
    public function view(User $user, PrdAnalysis $analysis): bool
    {
        return true;
    }

    public function update(User $user, PrdAnalysis $analysis): bool
    {
        return $user->isAdmin() || $analysis->user_id === $user->id;
    }

    public function delete(User $user, PrdAnalysis $analysis): bool
    {
        return $this->update($user, $analysis);
    }
}
