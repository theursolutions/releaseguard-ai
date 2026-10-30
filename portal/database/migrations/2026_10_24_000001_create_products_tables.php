<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('products', function (Blueprint $table) {
            $table->id();
            $table->string('name', 100);
            $table->string('slug', 100)->unique();
            $table->string('description', 255)->nullable();
            // Monitoring alarms whose name starts with this prefix belong to the product.
            $table->string('alarm_prefix', 100)->nullable();
            $table->timestamps();
        });

        Schema::create('product_user', function (Blueprint $table) {
            $table->foreignId('product_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->primary(['product_id', 'user_id']);
        });

        Schema::table('prd_analyses', function (Blueprint $table) {
            $table->foreignId('product_id')->nullable()->after('user_id')->constrained()->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('prd_analyses', function (Blueprint $table) {
            $table->dropConstrainedForeignId('product_id');
        });
        Schema::dropIfExists('product_user');
        Schema::dropIfExists('products');
    }
};
