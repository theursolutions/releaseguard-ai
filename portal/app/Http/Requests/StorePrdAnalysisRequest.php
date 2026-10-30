<?php

namespace App\Http\Requests;

use App\Enums\ConnectionType;
use App\Models\Connection;
use App\Models\Product;
use App\Services\Platform\AiProviderResolver;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class StorePrdAnalysisRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user() !== null;
    }

    public function rules(): array
    {
        $maxKb = config('releaseguard.prd.max_upload_kb');

        return [
            'source_type' => ['required', 'in:upload,confluence,text'],
            'product_id' => ['nullable', 'integer', 'exists:products,id'],
            'title' => ['nullable', 'string', 'max:255'],
            // 'mimes' checks the real content type, not the file name, so a renamed file is rejected.
            'file' => ['required_if:source_type,upload', 'nullable', 'file', "max:{$maxKb}", 'mimes:pdf,docx,md,txt'],
            'url' => ['required_if:source_type,confluence', 'nullable', 'url:https', 'max:1000'],
            'text' => ['required_if:source_type,text', 'nullable', 'string', 'min:50', 'max:400000'],
        ];
    }

    public function after(): array
    {
        return [
            function (Validator $validator) {
                $ai = app(AiProviderResolver::class);
                if ($ai->active() === null) {
                    $validator->errors()->add('source_type', $ai->missingMessage());
                }
                if ($this->filled('product_id') && ! $this->user()->canAccessProduct(Product::query()->find($this->integer('product_id')))) {
                    $validator->errors()->add('product_id', 'You do not have access to this product.');
                }
                if ($this->input('source_type') === 'confluence' && ! Connection::for(ConnectionType::Atlassian)?->isComplete()) {
                    $validator->errors()->add('url', 'Jira & Confluence is not connected yet. Upload the PRD as a file instead.');
                }
            },
        ];
    }

    public function messages(): array
    {
        return [
            'file.max' => 'The file must be 20 MB or smaller.',
            'file.mimes' => 'Upload a PDF, Word (.docx), Markdown or text file.',
            'text.min' => 'Paste at least a few sentences of the PRD.',
        ];
    }
}
