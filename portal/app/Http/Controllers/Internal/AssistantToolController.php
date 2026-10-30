<?php

namespace App\Http\Controllers\Internal;

use App\Http\Controllers\Controller;
use App\Services\Assistant\BusinessTools;
use App\Services\Assistant\ContextToken;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use InvalidArgumentException;

/**
 * Called only by the assistant service (machine to machine). Two checks before any data is read:
 * the service token (is this our assistant service?) and the signed context (which user and
 * product is this conversation for?). The tool then runs with that user's permissions.
 */
class AssistantToolController extends Controller
{
    public function __invoke(Request $request, string $tool, BusinessTools $tools): JsonResponse
    {
        $expected = (string) config('releaseguard.services.assistant.token');
        if ($expected === '' || ! hash_equals($expected, (string) $request->bearerToken())) {
            return response()->json(['error' => 'unauthenticated'], 401);
        }

        $context = ContextToken::verify($request->header('X-Assistant-Context'));
        if (! $context) {
            return response()->json(['error' => 'invalid or expired context'], 403);
        }

        if (! in_array($tool, BusinessTools::NAMES, true)) {
            return response()->json(['error' => 'unknown tool'], 404);
        }

        $input = $request->input('input', []);
        if (! is_array($input)) {
            return response()->json(['error' => 'input must be an object'], 422);
        }

        try {
            $result = $tools->run($tool, $input, $context['user'], $context['product']);
        } catch (InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }

        Log::info('Assistant tool used', ['tool' => $tool, 'user' => $context['user']->id, 'product' => $context['product']?->id]);

        return response()->json($result);
    }
}
