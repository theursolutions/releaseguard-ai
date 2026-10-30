<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * People who sign in with their CRM account get a local user linked by crm_user_id. The persona and
 * agency are a snapshot for display; what they may see is resolved again by the performance
 * service on every request.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->unsignedBigInteger('crm_user_id')->nullable()->unique()->after('role');
            $table->string('crm_persona', 20)->nullable()->after('crm_user_id');
            $table->unsignedBigInteger('crm_agency_id')->nullable()->after('crm_persona');
            $table->string('crm_agency_name')->nullable()->after('crm_agency_id');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropUnique(['crm_user_id']);
            $table->dropColumn(['crm_user_id', 'crm_persona', 'crm_agency_id', 'crm_agency_name']);
        });
    }
};
