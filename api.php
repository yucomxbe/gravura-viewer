<?php
/**
 * api.php — Gravura Viewer JSON API
 * GET api.php           → { tree, flat, stats }
 * GET api.php?refresh=1 → force cache bust
 */

require __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

$refresh = isset($_GET['refresh']);

// ?debug=1 — shows config + directory structure without scanning
if (isset($_GET['debug'])) {
    $root    = POSTERS_DIR;
    $exists  = is_dir($root);
    $entries = $exists ? array_diff(scandir($root), ['.','..']) : [];
    $sample  = [];
    foreach (array_slice($entries, 0, 3) as $e) {
        $sub = array_diff(@scandir("$root/$e") ?: [], ['.','..']);
        $sample[$e] = array_values(array_slice($sub, 0, 3));
    }
    echo json_encode([
        'POSTERS_DIR'     => $root,
        'dir_exists'      => $exists,
        'readable'        => $exists && is_readable($root),
        'top_level_dirs'  => array_values($entries),
        'sample_children' => $sample,
        'STATE_FILE'      => defined('STATE_FILE') ? STATE_FILE : '(not set)',
        'state_exists'    => defined('STATE_FILE') && STATE_FILE && file_exists(STATE_FILE),
        'php_version'     => PHP_VERSION,
        'sys_tmp'         => sys_get_temp_dir(),
    ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    exit;
}

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

    $state = readState();
    $flat  = [];
    $tree  = [];

    $skipDirs = ['mock', 'cache', '.cache', 'tmp', '.', '..'];

    if (!is_dir(POSTERS_DIR)) {
        return buildResult([], [], 'Directory not found: ' . POSTERS_DIR);
    }

    // Level 1: type
    foreach (scandir(POSTERS_DIR) as $type) {
        if (in_array(strtolower($type), $skipDirs, true)) continue;
        $typeDir = POSTERS_DIR . '/' . $type;
        if (!is_dir($typeDir)) continue;

        // Level 2: country code
        foreach (scandir($typeDir) as $ccRaw) {
            if ($ccRaw === '.' || $ccRaw === '..') continue;
            $ccDir = $typeDir . '/' . $ccRaw;
            if (!is_dir($ccDir)) continue;
            $cc = strtoupper($ccRaw);

            // Level 3: city
            foreach (scandir($ccDir) as $city) {
                if ($city === '.' || $city === '..') continue;
                $cityDir = $ccDir . '/' . $city;
                if (!is_dir($cityDir)) continue;

                $allFiles = array_diff(scandir($cityDir), ['.', '..']);

                // Source PNGs only (not thumbnails)
                $sources = array_filter(
                    $allFiles,
                    fn($f) => str_ends_with($f, '.png') && !str_ends_with($f, '-thumb.png')
                );

                foreach ($sources as $png) {
                    $relPath = "$type/$ccRaw/$city/$png";
                    $absPath = "$cityDir/$png";
                    $st      = @stat($absPath);
                    if (!$st) continue;

                    $thumbName = preg_replace('/\.png$/', '-thumb.png', $png);
                    $hasThumb  = in_array($thumbName, $allFiles, true);

                    $base    = preg_replace('/\.png$/', '', $png);
                    $pdfFile = null;
                    foreach ($allFiles as $f) {
                        if (str_ends_with($f, '.pdf') && str_starts_with($f, $base)) {
                            $pdfFile = $f;
                            break;
                        }
                    }

                    // Match state entry
                    $keyDir  = "$type/$ccRaw/$city";
                    $se      = $state[$relPath] ?? null;
                    if (!$se && isset($state[$keyDir])) {
                        $candidate = $state[$keyDir];
                        if (isset($candidate['source']) && str_ends_with($candidate['source'], $png)) {
                            $se = $candidate;
                        }
                    }

                    $thumbRel = $hasThumb ? "$type/$ccRaw/$city/$thumbName" : null;
                    $pdfRel   = $pdfFile  ? "$type/$ccRaw/$city/$pdfFile"   : null;
                    $damBase  = rtrim(DAM_BASE_URL, '/');

                    $flat[] = [
                        'id'          => $relPath,
                        'type'        => $type,
                        'cc'          => $cc,
                        'city'        => $city,
                        'filename'    => $png,
                        'path'        => $relPath,
                        'size'        => (int)$st['size'],
                        'mtime'       => date('c', $st['mtime']),
                        'thumb'       => $thumbRel,
                        'pdf'         => $pdfRel,
                        'status'      => $se ? 'published' : 'pending',
                        'publishedAt' => $se['publishedAt'] ?? null,
                        'damSource'   => ($se && !empty($se['source']))
                                         ? "$damBase/{$se['source']}" : null,
                        'damThumb'    => ($se && !empty($se['thumb']))
                                         ? "$damBase/{$se['thumb']}"  : null,
                        'damPdf'      => ($se && !empty($se['pdf']))
                                         ? "$damBase/{$se['pdf']}"    : null,
                    ];

                    $tree[$type]        ??= [];
                    $tree[$type][$cc]   ??= [];
                    $tree[$type][$cc][$city] ??= 0;
                    $tree[$type][$cc][$city]++;
                }
            }
        }
    }

    // Sort
    usort($flat, fn($a, $b) => strcmp($b['mtime'], $a['mtime']));
    ksort($tree);
    foreach ($tree as &$ccs) {
        ksort($ccs);
        foreach ($ccs as &$cities) ksort($cities);
    }
    unset($ccs, $cities);

    $result = buildResult($tree, $flat);

    // Cache to temp file
    file_put_contents($cacheFile, json_encode($result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));

    return $result;
}

function buildResult(array $tree, array $flat, ?string $error = null): array
{
    $published = count(array_filter($flat, fn($p) => $p['status'] === 'published'));
    $ccs       = array_unique(array_column($flat, 'cc'));
    $cityKeys  = array_unique(array_map(fn($p) => $p['cc'] . '/' . $p['city'], $flat));

    $result = [
        'tree'  => $tree,
        'flat'  => $flat,
        'stats' => [
            'total'     => count($flat),
            'published' => $published,
            'pending'   => count($flat) - $published,
            'withThumb' => count(array_filter($flat, fn($p) => $p['thumb'])),
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

function readState(): array
{
    $file = defined('STATE_FILE') ? STATE_FILE : '';
    if (!$file || !file_exists($file)) return [];
    $raw = file_get_contents($file);
    return json_decode($raw, true) ?? [];
}
