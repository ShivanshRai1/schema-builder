<?php
/**
 * Shared workspace store (pre-login global save).
 *
 *   GET  ?action=get
 *        -> { ok: true, workspace: {...}, updatedAt: "..." }
 *        -> { ok: false, error: "empty" } when nothing saved yet
 *
 *   POST action=save  (JSON body = WorkspaceFile, or form field workspace=<json>)
 *        -> { ok: true, updatedAt: "...", name: "..." }
 *
 * Later: add ownerId / auth and per-user files. For now one shared file for all visitors.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Accept');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

define('MAX_WORKSPACE_BYTES', 2 * 1024 * 1024); // 2 MB

$dataDir = dirname(__FILE__) . '/data';
$storeFile = $dataDir . '/workspace-shared.json';

function fail($code, $msg) {
    http_response_code($code);
    echo json_encode(array('ok' => false, 'error' => $msg));
    exit;
}

function ensure_data_dir($dir) {
    if (is_dir($dir)) return;
    if (!@mkdir($dir, 0755, true) && !is_dir($dir)) {
        fail(500, 'Cannot create data directory (check PHP write permissions)');
    }
}

$action = isset($_GET['action']) ? $_GET['action'] : (isset($_POST['action']) ? $_POST['action'] : '');
if ($action === '' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    $action = 'get';
}
if ($action === '' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = 'save';
}

if ($action === 'get') {
    if (!is_readable($storeFile)) {
        echo json_encode(array('ok' => false, 'error' => 'empty'));
        exit;
    }
    $raw = file_get_contents($storeFile);
    if ($raw === false || $raw === '') {
        echo json_encode(array('ok' => false, 'error' => 'empty'));
        exit;
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded) || empty($decoded['workspace'])) {
        fail(500, 'Corrupt workspace store');
    }
    echo json_encode(array(
        'ok' => true,
        'workspace' => $decoded['workspace'],
        'updatedAt' => isset($decoded['updatedAt']) ? $decoded['updatedAt'] : null,
    ));
    exit;
}

if ($action === 'save') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        fail(405, 'POST required');
    }

    $body = file_get_contents('php://input');
    $workspace = null;

    if ($body !== false && strlen($body) > 0) {
        if (strlen($body) > MAX_WORKSPACE_BYTES) {
            fail(413, 'Workspace too large');
        }
        $ct = isset($_SERVER['CONTENT_TYPE']) ? $_SERVER['CONTENT_TYPE'] : '';
        if (stripos($ct, 'application/json') !== false || (isset($body[0]) && ($body[0] === '{' || $body[0] === '['))) {
            $parsed = json_decode($body, true);
            if (is_array($parsed) && isset($parsed['format'])) {
                $workspace = $parsed;
            } elseif (is_array($parsed) && isset($parsed['workspace'])) {
                $workspace = $parsed['workspace'];
            }
        }
    }

    if ($workspace === null && isset($_POST['workspace'])) {
        $raw = $_POST['workspace'];
        if (strlen($raw) > MAX_WORKSPACE_BYTES) {
            fail(413, 'Workspace too large');
        }
        $workspace = json_decode($raw, true);
    }

    if (!is_array($workspace)) {
        fail(400, 'Invalid workspace JSON');
    }
    if (!isset($workspace['format']) || $workspace['format'] !== 'simulai-workspace') {
        fail(400, 'Not a simulai-workspace payload');
    }
    if (!isset($workspace['tabs']) || !is_array($workspace['tabs']) || count($workspace['tabs']) < 1) {
        fail(400, 'Workspace needs at least one tab');
    }
    if (!isset($workspace['name']) || !is_string($workspace['name']) || trim($workspace['name']) === '') {
        fail(400, 'Workspace missing name');
    }

    $now = gmdate('c');
    $workspace['savedAt'] = $now;
    // Reserved for future login-based saves.
    if (!array_key_exists('ownerId', $workspace)) {
        $workspace['ownerId'] = null;
    }

    ensure_data_dir($dataDir);
    $payload = array(
        'updatedAt' => $now,
        'workspace' => $workspace,
    );
    $json = json_encode($payload);
    if ($json === false) {
        fail(500, 'JSON encode failed');
    }

    $tmp = $storeFile . '.tmp';
    if (@file_put_contents($tmp, $json, LOCK_EX) === false) {
        fail(500, 'Cannot write workspace (check PHP write permissions on php-sim/data)');
    }
    if (!@rename($tmp, $storeFile)) {
        @unlink($tmp);
        fail(500, 'Cannot finalize workspace file');
    }

    echo json_encode(array(
        'ok' => true,
        'updatedAt' => $now,
        'name' => $workspace['name'],
        'scope' => 'shared',
    ));
    exit;
}

fail(400, 'Unknown action (use get or save)');
