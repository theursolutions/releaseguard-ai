<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('prd_analyses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('title');
            $table->string('source_type', 20); // upload | confluence | text
            $table->string('source_name', 500)->nullable();
            $table->string('file_path')->nullable();
            $table->string('file_mime', 100)->nullable();
            $table->longText('source_text')->nullable();
            $table->string('status', 20)->default('queued')->index();
            $table->unsignedTinyInteger('score')->nullable();
            $table->json('result')->nullable();
            $table->string('error', 500)->nullable();
            $table->string('model', 60)->nullable();
            $table->unsignedInteger('input_tokens')->nullable();
            $table->unsignedInteger('output_tokens')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->index('created_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('prd_analyses');
    }
};
