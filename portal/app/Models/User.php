<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable;

    public const ROLE_ADMIN = 'admin';

    public const ROLE_MEMBER = 'member';

    public const ROLES = [self::ROLE_ADMIN, self::ROLE_MEMBER];

    // Matches the column default, so a user created in this request already knows its role.
    protected $attributes = ['role' => self::ROLE_MEMBER];

    /**
     * The attributes that are mass assignable. 'role' is deliberately not fillable:
     * only admins change it, through UserController.
     *
     * @var list<string>
     */
    protected $fillable = [
        'name',
        'email',
        'password',
    ];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var list<string>
     */
    protected $hidden = [
        'password',
        'remember_token',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
        ];
    }

    public function isAdmin(): bool
    {
        return $this->role === self::ROLE_ADMIN;
    }

    /** Signed in with a CRM account (agency owner, agency admin, agent or CRM moderator). */
    public function isCrmUser(): bool
    {
        return $this->crm_user_id !== null;
    }

    /** Performance dashboards: ReleaseGuard admins (executives) and CRM users (scoped by their CRM role). */
    public function canSeePerformance(): bool
    {
        return $this->isAdmin() || $this->isCrmUser();
    }

    /**
     * Who is asking, for the performance service. Executives see every agency; CRM users are
     * resolved by the service from their live CRM role on every call.
     *
     * @return array{kind: string, crm_user_id?: int}
     */
    public function performanceViewer(): array
    {
        return $this->isCrmUser() ? ['kind' => 'crm', 'crm_user_id' => (int) $this->crm_user_id] : ['kind' => 'executive'];
    }

    public function products(): BelongsToMany
    {
        return $this->belongsToMany(Product::class);
    }

    /** Products this person may see: admins see all, members only those assigned to them. */
    public function authorizedProducts(): Collection
    {
        return $this->isAdmin() ? Product::query()->orderBy('name')->get() : $this->products()->orderBy('name')->get();
    }

    public function canAccessProduct(?Product $product): bool
    {
        return $product === null || $this->isAdmin() || $this->products()->whereKey($product->id)->exists();
    }
}
