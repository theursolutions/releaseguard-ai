<?php

namespace App\Console\Commands;

use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\Rules\Password;

class MakeAdmin extends Command
{
    protected $signature = 'portal:make-admin {email} {--name=}';

    protected $description = 'Create a ReleaseGuard portal admin, or promote an existing user to admin';

    public function handle(): int
    {
        $email = (string) $this->argument('email');
        $user = User::query()->where('email', $email)->first();

        if ($user) {
            $user->forceFill(['role' => User::ROLE_ADMIN])->save();
            $this->info("{$email} is now an admin.");

            return self::SUCCESS;
        }

        $name = $this->option('name') ?: $this->ask('Name');
        $password = $this->secret('Password (min. 8 characters)');

        $validator = Validator::make(
            ['email' => $email, 'name' => $name, 'password' => $password],
            ['email' => ['required', 'email'], 'name' => ['required', 'string', 'max:255'], 'password' => ['required', Password::defaults()]],
        );
        if ($validator->fails()) {
            foreach ($validator->errors()->all() as $error) {
                $this->error($error);
            }

            return self::FAILURE;
        }

        $user = User::create(['name' => $name, 'email' => $email, 'password' => $password]);
        $user->forceFill(['role' => User::ROLE_ADMIN, 'email_verified_at' => now()])->save();
        $this->info("Admin {$email} created. Sign in at ".config('app.url'));

        return self::SUCCESS;
    }
}
