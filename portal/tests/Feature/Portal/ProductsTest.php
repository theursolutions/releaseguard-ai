<?php

namespace Tests\Feature\Portal;

use App\Enums\ConnectionType;
use App\Models\Connection;
use App\Models\PrdAnalysis;
use App\Models\Product;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

class ProductsTest extends TestCase
{
    use RefreshDatabase;

    public function test_only_admins_manage_products(): void
    {
        $member = User::factory()->create();

        $this->actingAs($member)->get('/products')->assertForbidden();
        $this->actingAs($member)->post('/products', ['name' => 'CRM'])->assertForbidden();
    }

    public function test_admin_creates_updates_and_removes_a_product(): void
    {
        $admin = User::factory()->admin()->create();
        $member = User::factory()->create();

        $this->actingAs($admin)->post('/products', ['name' => 'CRM Suite', 'alarm_prefix' => 'production-crm-', 'user_ids' => [$member->id]])->assertSessionHasNoErrors();
        $product = Product::sole();
        $this->assertSame('crm-suite', $product->slug);
        $this->assertTrue($member->canAccessProduct($product));

        $this->actingAs($admin)->post('/products', ['name' => 'CRM Suite'])->assertSessionHasErrors('name');
        $this->actingAs($admin)->post('/products', ['name' => 'Other', 'alarm_prefix' => 'bad prefix!'])->assertSessionHasErrors('alarm_prefix');

        $this->actingAs($admin)->put("/products/{$product->id}", ['name' => 'CRM Suite', 'user_ids' => []])->assertSessionHasNoErrors();
        $this->assertFalse($member->fresh()->canAccessProduct($product));

        $analysis = PrdAnalysis::create(['user_id' => $admin->id, 'product_id' => $product->id, 'source_type' => 'text', 'title' => 'Kept', 'status' => 'completed']);
        $this->actingAs($admin)->delete("/products/{$product->id}")->assertRedirect();
        $this->assertModelMissing($product);
        $this->assertNull($analysis->fresh()->product_id);
    }

    public function test_prd_upload_can_only_use_an_authorised_product(): void
    {
        Queue::fake();
        Connection::create(['type' => ConnectionType::Anthropic, 'settings' => ['auth_method' => 'api_key', 'api_key' => 'sk-ant-test-123456789', 'model' => '']]);
        $member = User::factory()->create();
        $mine = Product::create(['name' => 'Mine', 'slug' => 'mine']);
        $theirs = Product::create(['name' => 'Theirs', 'slug' => 'theirs']);
        $mine->users()->attach($member);
        $text = str_repeat('Owners invite agents by email and approve them. ', 3);

        $this->actingAs($member)->post('/prd', ['source_type' => 'text', 'text' => $text, 'product_id' => $theirs->id])->assertSessionHasErrors('product_id');
        $this->actingAs($member)->post('/prd', ['source_type' => 'text', 'text' => $text, 'product_id' => $mine->id])->assertSessionHasNoErrors();

        $this->assertSame($mine->id, PrdAnalysis::sole()->product_id);
    }
}
