<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/** A spoken or typed correction to one PRD flow. Only the review's author or an admin may correct it. */
class CorrectPrdFlowRequest extends FormRequest
{
    public function authorize(): bool
    {
        return $this->user()?->can('update', $this->route('analysis')) ?? false;
    }

    public function rules(): array
    {
        return [
            'instruction' => ['required', 'string', 'min:3', 'max:1000'],
        ];
    }
}
