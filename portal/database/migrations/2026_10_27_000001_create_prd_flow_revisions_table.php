<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Corrected versions of one flow in a PRD review. Version 0 is the flow in the review itself.
        Schema::create('prd_flow_revisions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('prd_analysis_id')->constrained()->cascadeOnDelete();
            $table->string('flow_id', 60);
            $table->unsignedSmallInteger('version');
            $table->json('flow');
            $table->text('instruction')->nullable(); // null when an earlier version was restored
            $table->text('change_summary');
            $table->unsignedSmallInteger('restored_from_version')->nullable();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('model', 60)->nullable();
            $table->timestamps();
            $table->unique(['prd_analysis_id', 'flow_id', 'version']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('prd_flow_revisions');
    }
};
