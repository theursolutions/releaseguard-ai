<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('alarm_diagnoses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('alarm_name');
            $table->json('alarm');
            $table->boolean('is_demo')->default(false);
            $table->string('status', 20)->default('queued')->index();
            $table->json('result')->nullable();
            $table->string('error', 500)->nullable();
            $table->string('model', 60)->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->index(['alarm_name', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('alarm_diagnoses');
    }
};
