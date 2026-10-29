<?php

declare(strict_types=1);

require_once __DIR__ . '/../src/Database.php';
require_once __DIR__ . '/../src/CommentController.php';

use OmniComment\CommentController;

// -----------------------------------------------------------------------------
// CORS Headers & Preflight
// -----------------------------------------------------------------------------
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// -----------------------------------------------------------------------------
// Request Routing
// -----------------------------------------------------------------------------
$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '/';
$method = $_SERVER['REQUEST_METHOD'];

$inputData = [];
if (in_array($method, ['POST', 'PATCH', 'PUT'])) {
    $rawInput = file_get_contents('php://input');
    if (!empty($rawInput)) {
        $inputData = json_decode($rawInput, true) ?: [];
    }
}

$controller = new CommentController();

// Route: GET /health
if ($uri === '/health' && $method === 'GET') {
    $controller->health();
    exit;
}

// Route: /api/documents/{docId}/comments[/{commentId}][/replies]
if (preg_match('#^/api/documents/([^/]+)/comments(?:/([^/]+)(?:/(replies))?)?/?$#', $uri, $matches)) {
    $docId = urldecode($matches[1]);
    $commentId = isset($matches[2]) ? urldecode($matches[2]) : null;
    $isReplies = isset($matches[3]) && $matches[3] === 'replies';

    if ($commentId === null) {
        if ($method === 'GET') {
            $controller->listComments($docId);
            exit;
        } elseif ($method === 'POST') {
            $controller->createComment($docId, $inputData);
            exit;
        }
    } else {
        if ($isReplies) {
            if ($method === 'POST') {
                $controller->addReply($docId, $commentId, $inputData);
                exit;
            }
        } else {
            if ($method === 'GET') {
                $controller->getComment($docId, $commentId);
                exit;
            } elseif ($method === 'PATCH') {
                $controller->updateComment($docId, $commentId, $inputData);
                exit;
            } elseif ($method === 'DELETE') {
                $controller->deleteComment($docId, $commentId);
                exit;
            }
        }
    }
}

// Fallback: 404 Not Found
http_response_code(404);
header('Content-Type: application/json; charset=utf-8');
echo json_encode(['success' => false, 'error' => 'Endpoint not found: ' . $uri]);
