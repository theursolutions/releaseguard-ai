<?php

namespace App\Services\Crm;

use App\Enums\ConnectionType;
use App\Models\Connection;
use App\Models\User;
use App\Services\Platform\CredentialBroker;
use App\Services\Platform\ServiceClient;
use App\Services\Platform\ServiceException;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Sign-in with an existing CRM / HomeNet account. The password is checked by the performance service
 * against the CRM users table (read-only) and is never stored here. A linked local user is created or
 * refreshed; it has an unusable random password, so it can only sign in through the CRM again.
 */
class CrmSignIn
{
    public function __construct(private readonly ServiceClient $services, private readonly CredentialBroker $broker) {}

    public function available(): bool
    {
        return (bool) Connection::for(ConnectionType::CrmDatabase)?->isComplete();
    }

    /**
     * @return User|null null when the CRM does not know these credentials
     *
     * @throws ValidationException when the person is known but may not sign in, or the CRM is unreachable
     */
    public function attempt(string $email, string $password): ?User
    {
        if (! $this->available() || ! str_contains($email, '@')) {
            return null;
        }

        try {
            $result = $this->services->post('performance', '/v1/identity/verify', [
                'email' => $email,
                'password' => $password,
                'credentials' => $this->broker->forService('performance'),
            ]);
        } catch (ServiceException $e) {
            if ($e->status === 401) {
                return null;
            }
            if ($e->status === 403) {
                throw ValidationException::withMessages(['email' => $e->getMessage()]);
            }
            Log::warning('CRM sign-in unavailable', ['status' => $e->status]);
            throw ValidationException::withMessages(['email' => 'Sign-in with CRM accounts is temporarily unavailable. Please try again shortly.']);
        }

        return $this->link($result['identity']);
    }

    /** @param array<string, mixed> $identity */
    private function link(array $identity): User
    {
        $user = User::query()->where('crm_user_id', $identity['crm_user_id'])->first();
        $emailOwner = User::query()->where('email', $identity['email'])->first();
        if ($emailOwner && $emailOwner->crm_user_id !== (int) $identity['crm_user_id']) {
            // A ReleaseGuard account already uses this email; never merge the two silently.
            throw ValidationException::withMessages(['email' => 'This email belongs to a ReleaseGuard account. Sign in with that account\'s password.']);
        }

        $user ??= new User(['password' => Str::random(64)]);
        $user->fill(['name' => $identity['name'], 'email' => $identity['email']]);
        $user->forceFill([
            'crm_user_id' => $identity['crm_user_id'],
            'crm_persona' => $identity['persona'],
            'crm_agency_id' => $identity['agency_id'],
            'crm_agency_name' => $identity['agency_name'],
            'role' => User::ROLE_MEMBER, // never a ReleaseGuard admin through the CRM
            'email_verified_at' => $user->email_verified_at ?? now(), // the CRM already owns this identity
        ])->save();

        return $user;
    }
}
