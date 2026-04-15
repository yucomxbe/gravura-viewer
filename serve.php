<?php
/**
 * serve.php — Secure file server for poster assets
 * GET serve.php?f=type/CC/city/filename.png
 * GET serve.php?f=type/CC/city/filename-thumb.png
 * GET serve.php?f=type/CC/city/filename.pdf
 */

require __DIR__ . '/config.php';

$relpath = $_GET['f'] ?? '';

// ── Security: prevent path traversal ──────────────────────────────────────────
if ($relpath === '') {
    http_response_code(400);
    exit('Missing parameter');
}

// Normalize separators, strip traversal sequences
$relpath = str_replace('\\', '/', $relpath);
$relpath = preg_replace('/\.\.+\//', '', $relpath);
$relpath = ltrim($relpath, '/');

$absPath  = POSTERS_DIR . '/' . $relpath;
$realBase = realpath(POSTERS_DIR);
$realAbs  = realpath($absPath);

if (!$realBase || !$realAbs || strncmp($realAbs, $realBase . DIRECTORY_SEPARATOR, strlen($realBase) + 1) !== 0) {
    http_response_code(403);
    exit('Forbidden');
}

if (!is_file($realAbs)) {
    http_response_code(404);
    exit('Not found');
}

// ── Content-Type ──────────────────────────────────────────────────────────────
$ext   = strtolower(pathinfo($realAbs, PATHINFO_EXTENSION));
$mimes = [
    'png'  => 'image/png',
    'jpg'  => 'image/jpeg',
    'jpeg' => 'image/jpeg',
    'pdf'  => 'application/pdf',
    'webp' => 'image/webp',
];
$mime = $mimes[$ext] ?? 'application/octet-stream';

// ── Headers ───────────────────────────────────────────────────────────────────
$size     = filesize($realAbs);
$filename = basename($realAbs);

header('Content-Type: ' . $mime);
header('Content-Length: ' . $size);
header('Cache-Control: public, max-age=86400, immutable');
header('X-Content-Type-Options: nosniff');

// PDFs open inline in browser (for the PDF viewer iframe)
if ($ext === 'pdf') {
    header('Content-Disposition: inline; filename="' . addslashes($filename) . '"');
} else {
    header('Content-Disposition: inline');
}

// ── Stream file ───────────────────────────────────────────────────────────────
// readfile() streams directly without loading into PHP memory — safe for large PNGs
if (ob_get_level()) ob_end_clean();
readfile($realAbs);
exit;
