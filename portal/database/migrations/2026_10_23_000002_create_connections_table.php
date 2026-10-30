<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('connections', function (Blueprint $table) {
            $table->id();
            $table->string('type', 30)->unique();
            // Encrypted with APP_KEY (encrypted:array cast). Never sent to the browser.
            $table->text('settings');
            $table->string('status', 20)->default('untested');
            $table->timestamp('last_tested_at')->nullable();
            $table->string('last_error', 500)->nullable();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('connections');
    }
};
