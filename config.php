<?php
/**
 * config.php — Gravura Viewer configuration
 * Edit this file before deploying.
 */

// Absolute path to the posters directory on the server
// Must contain {type}/{CC}/{city}/*.png structure
define('POSTERS_DIR', '/home2/sc1bexa4078/dam.gravura-poster.com/upload/posters');

// Absolute path to .publish-state.json (optional — enables published/pending badges)
// Leave empty string '' to disable
define('STATE_FILE', '');

// DAM base URL for direct CDN links in the detail panel (optional)
define('DAM_BASE_URL', 'https://dam.gravura-poster.com/upload/posters');

// Scan cache TTL in seconds (file-based, uses sys_get_temp_dir)
define('CACHE_TTL', 30);
