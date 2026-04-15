<?php
/**
 * api.php — Gravura Viewer JSON API
 * GET api.php           → { tree, flat, stats }
 * GET api.php?refresh=1 → force cache bust
 * GET api.php?debug=1   → path diagnostics
 */

require __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

// ?debug=1 — shows config + full 3-level directory tree sample
if (isset($_GET['debug'])) {
    $root   = POSTERS_DIR;
    $exists = is_dir($root);
    $tree   = [];

    if ($exists) {
        foreach (array_diff(scandir($root), ['.','..']) as $type) {
            $typeDir = "$root/$type";
            if (!is_dir($typeDir)) continue;
            $tree[$type] = [];
            foreach (array_slice(array_diff(scandir($typeDir), ['.','..']), 0, 2) as $cc) {
                $ccDir = "$typeDir/$cc";
                if (!is_dir($ccDir)) continue;
                $ccContents = array_diff(scandir($ccDir), ['.','..']);
                $tree[$type][$cc] = [];
                foreach (array_slice($ccContents, 0, 3) as $entry) {
                    $entryPath = "$ccDir/$entry";
                    if (is_dir($entryPath)) {
                        $files = array_diff(scandir($entryPath), ['.','..']);
                        $tree[$type][$cc]["$entry/"] = array_values(array_slice($files, 0, 5));
                    } else {
                        $tree[$type][$cc][] = $entry;
                    }
                }
            }
        }
    }

    echo json_encode([
        'POSTERS_DIR' => $root,
        'dir_exists'  => $exists,
        'readable'    => $exists && is_readable($root),
        'tree_sample' => $tree,
        'STATE_FILE'  => defined('STATE_FILE') ? STATE_FILE : '(not set)',
        'state_exists'=> defined('STATE_FILE') && STATE_FILE && file_exists(STATE_FILE),
        'php_version' => PHP_VERSION,
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}

$refresh = isset($_GET['refresh']);

try {
    echo json_encode(getScan($refresh), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
} catch (Throwable $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}

// ── Scan ──────────────────────────────────────────────────────────────────────

function getScan(bool $force = false): array
{
    $cacheFile = sys_get_temp_dir() . '/gravura_scan_' . md5(POSTERS_DIR) . '.json';

    if (!$force && file_exists($cacheFile) && (time() - filemtime($cacheFile)) < CACHE_TTL) {
        $cached = json_decode(file_get_contents($cacheFile), true);
        if ($cached) return $cached;
    }

    // On the FTP/DAM server only thumbnails and PDFs are stored.
    // We use *-thumb.png files as the poster reference.
    $manifest = readManifest();   // array of ManifestEntry from manifest.json
    $thumbIndex = buildThumbIndex($manifest);

    $flat = [];
    $tree = [];

    $skipDirs = ['mock', 'cache', '.cache', 'tmp', '.', '..'];

    if (!is_dir(POSTERS_DIR)) {
        return buildResult([], [], 'Directory not found: ' . POSTERS_DIR);
    }

    foreach (scandir(POSTERS_DIR) as $type) {
        if (in_array(strtolower($type), $skipDirs, true)) continue;
        $typeDir = POSTERS_DIR . '/' . $type;
        if (!is_dir($typeDir)) continue;

        foreach (scandir($typeDir) as $ccRaw) {
            if ($ccRaw === '.' || $ccRaw === '..') continue;
            $ccDir = $typeDir . '/' . $ccRaw;
            if (!is_dir($ccDir)) continue;
            $cc = strtoupper($ccRaw);

            foreach (scandir($ccDir) as $city) {
                if ($city === '.' || $city === '..') continue;
                $cityDir = $ccDir . '/' . $city;
                if (!is_dir($cityDir)) continue;

                $allFiles = array_values(array_diff(scandir($cityDir), ['.', '..']));

                // Use thumbnail files as the primary poster reference
                $thumbFiles = array_filter($allFiles, fn($f) => str_ends_with($f, '-thumb.png'));

                foreach ($thumbFiles as $thumbName) {
                    // Base name without "-thumb.png"
                    $base = preg_replace('/-thumb\.png$/', '', $thumbName);

                    // Find matching PDF (same base name prefix)
                    $pdfFile = null;
                    foreach ($allFiles as $f) {
                        if (str_ends_with($f, '.pdf') && str_starts_with($f, $base)) {
                            $pdfFile = $f;
                            break;
                        }
                    }

                    $thumbRel = "$type/$ccRaw/$city/$thumbName";
                    $absThumb = "$cityDir/$thumbName";
                    $st       = @stat($absThumb);
                    if (!$st) continue;

                    $damBase = rtrim(DAM_BASE_URL, '/');
                    $pdfRel  = $pdfFile ? "$type/$ccRaw/$city/$pdfFile" : null;

                    // Match against manifest for rich publish metadata
                    $entry = $thumbIndex[$thumbRel] ?? matchManifestEntry($manifest, $cc, $city, $thumbName);

                    $flat[] = [
                        'id'          => $thumbRel,
                        'type'        => $type,
                        'cc'          => $cc,
                        'city'        => $city,
                        'filename'    => $base,           // display name (without -thumb)
                        'path'        => $thumbRel,       // best available (thumb = only file on FTP)
                        'size'        => (int)$st['size'],
                        'mtime'       => date('c', $st['mtime']),
                        'thumb'       => $thumbRel,
                        'pdf'         => $pdfRel,
                        'status'      => 'published',     // everything on FTP/DAM = published
                        'publishedAt' => $entry['publishedAt'] ?? date('c', $st['mtime']),
                        'damSource'   => $entry['source'] ?? null,
                        'damThumb'    => $entry['thumb']  ?? ($damBase ? "$damBase/$thumbRel" : null),
                        'damPdf'      => $entry['pdf']    ?? ($pdfRel && $damBase ? "$damBase/$pdfRel" : null),
                    ];

                    $tree[$type]        ??= [];
                    $tree[$type][$cc]   ??= [];
                    $tree[$type][$cc][$city] ??= 0;
                    $tree[$type][$cc][$city]++;
                }
            }
        }
    }

    usort($flat, fn($a, $b) => strcmp($b['mtime'], $a['mtime']));
    ksort($tree);
    foreach ($tree as &$ccs) {
        ksort($ccs);
        foreach ($ccs as &$cities) ksort($cities);
    }
    unset($ccs, $cities);

    $result = buildResult($tree, $flat);
    file_put_contents($cacheFile, json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    return $result;
}

// ── Manifest reader ───────────────────────────────────────────────────────────

/**
 * Read manifest.json — array of ManifestEntry objects.
 */
function readManifest(): array
{
    $file = defined('STATE_FILE') ? STATE_FILE : '';
    if (!$file || !file_exists($file)) return [];
    $raw  = file_get_contents($file);
    $data = json_decode($raw, true);
    // Manifest is a JSON array; .publish-state.json is an object — handle both
    if (is_array($data) && isset($data[0])) return $data;          // manifest.json array
    if (is_array($data)) return array_values($data);               // state object → flatten
    return [];
}

/**
 * Build an index of manifest entries keyed by the relative thumb path
 * extracted from the full DAM URL.
 */
function buildThumbIndex(array $manifest): array
{
    $idx     = [];
    $damBase = rtrim(DAM_BASE_URL, '/') . '/';
    foreach ($manifest as $entry) {
        $thumbUrl = $entry['thumb'] ?? null;
        if (!$thumbUrl) continue;
        // Strip DAM base URL to get relative path: type/CC/city/file-thumb.png
        $rel = str_starts_with($thumbUrl, $damBase)
             ? substr($thumbUrl, strlen($damBase))
             : ltrim(parse_url($thumbUrl, PHP_URL_PATH), '/');
        // Remove any leading /posters/ segment that may appear in the URL path
        $rel = preg_replace('#^posters/#', '', $rel);
        $idx[$rel] = $entry;
    }
    return $idx;
}

/**
 * Fuzzy match: find a manifest entry by CC + city + thumb filename.
 */
function matchManifestEntry(array $manifest, string $cc, string $city, string $thumbName): ?array
{
    $ccLow   = strtolower($cc);
    $cityLow = strtolower($city);
    foreach ($manifest as $entry) {
        if (strtolower($entry['country'] ?? '') === $ccLow
            && strtolower($entry['city']    ?? '') === $cityLow) {
            $thumbUrl = $entry['thumb'] ?? '';
            if (str_contains($thumbUrl, rawurlencode($thumbName))
             || str_contains($thumbUrl, $thumbName)) {
                return $entry;
            }
        }
    }
    return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildResult(array $tree, array $flat, ?string $error = null): array
{
    $ccs      = array_unique(array_column($flat, 'cc'));
    $cityKeys = array_unique(array_map(fn($p) => $p['cc'] . '/' . $p['city'], $flat));

    $result = [
        'tree'  => $tree,
        'flat'  => $flat,
        'stats' => [
            'total'     => count($flat),
            'published' => count($flat),   // all FTP files = published
            'pending'   => 0,
            'withThumb' => count($flat),   // thumb IS the file
            'withPdf'   => count(array_filter($flat, fn($p) => $p['pdf'])),
            'types'     => array_values(array_unique(array_column($flat, 'type'))),
            'countries' => count($ccs),
            'cities'    => count($cityKeys),
            'lastScan'  => date('c'),
        ],
    ];
    if ($error) $result['error'] = $error;
    return $result;
}
