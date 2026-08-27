<?php
/**
 * DiscoverEE — SPICE Simulation Proxy
 * PHP 5.2 compatible (a2hosting)
 *
 * Holds the API key server-side and relays arbitrary netlists + model files to
 * the DiscoverEE simulation fleet.
 *
 *   POST action=submit  netlist=<text>  engine=qspice|ngspice
 *                       models[]=<uploaded .sub files>   (optional, repeatable)
 *        -> {"job_id": "..."}
 *
 *   POST action=poll    job_id=<hex>
 *        -> the result JSON, passed straight through
 *
 * SECURITY
 *   - API key never reaches the browser.
 *   - Netlist directives are WHITELISTED (not blacklisted).
 *   - .include may only reference files uploaded in the same request.
 *   - Size, model-count and transient-stop-time caps applied.
 *   - Workers are disposable and hold no secrets; the 300 s engine timeout on
 *     the fleet is the final backstop.
 */

// ---------------------------------------------------------------- config ----

define('SIM_API_BASE', 'https://dsim-api.delightfulfield-df75864b.westus2.azurecontainerapps.io');

// ---- API key: loaded from sim_config.php ----
// Create a file named sim_config.php containing exactly:
//     <?php define('SIM_API_KEY', 'your-real-fleet-key');
// Place it EITHER in your home directory (outside public_html) OR right next to
// this script. The loader searches, in order: $HOME, the directory above the
// web root, then walks up from this script (covering app-in-subfolder layouts),
// so both placements are found regardless of how the host sets $HOME.
$__cfg_candidates = array();
if (getenv('HOME')) {
    $__cfg_candidates[] = getenv('HOME') . '/sim_config.php';               // ~/sim_config.php
}
if (!empty($_SERVER['DOCUMENT_ROOT'])) {
    $__cfg_candidates[] = dirname($_SERVER['DOCUMENT_ROOT']) . '/sim_config.php';  // dir above the web root
}
$__d = dirname(__FILE__);                                                   // walk up from this script...
for ($__i = 0; $__i < 5; $__i++) {                                          // ...covers subfolder deployments
    $__cfg_candidates[] = $__d . '/sim_config.php';
    $__d = dirname($__d);
}
foreach ($__cfg_candidates as $__c) {
    if ($__c !== '' && @is_readable($__c)) { require_once $__c; break; }
}

// Fail fast if the key was never provided, rather than calling the fleet with a
// placeholder and getting a confusing 401 downstream.
if (!defined('SIM_API_KEY') || SIM_API_KEY === '' || SIM_API_KEY === 'PUT-YOUR-API-KEY-HERE') {
    header('Content-Type: application/json');
    header('HTTP/1.1 500 Error');
    echo json_encode(array('error' =>
        'Server not configured: create sim_config.php with define(\'SIM_API_KEY\', ...) outside the web root.'));
    exit;
}

define('MAX_NETLIST_BYTES', 100000);   // 100 KB
define('MAX_MODEL_BYTES',   500000);   // 500 KB per model file
define('MAX_MODELS',        10);
define('MAX_TRAN_STOP',     10.0);     // seconds — reject absurdly long transients

// Directives the fleet is allowed to see. Anything starting with '.' that is not
// in this list is rejected.
$ALLOWED_DOTS = array(
    'tran','ac','dc','op','meas','measure','print','plot','probe','save',
    'model','subckt','ends','include','inc','lib','param','func','options',
    'option','ic','nodeset','temp','step','four','noise','tf','end','global',
    'control','endc','width','title'
);

// ---------------------------------------------------------------- helpers ---

header('Content-Type: application/json');

function fail($msg, $code) {
    header('HTTP/1.1 ' . $code . ' Error');
    echo json_encode(array('error' => $msg));
    exit;
}

/**
 * Validate a netlist: whitelist directives, restrict .include to uploaded models,
 * cap transient stop time.
 */
function validate_netlist($netlist, $allowed_dots, $uploaded_names) {
    if (strlen($netlist) > MAX_NETLIST_BYTES) {
        return 'Netlist exceeds ' . MAX_NETLIST_BYTES . ' bytes';
    }

    $lines = preg_split('/\r\n|\r|\n/', $netlist);
    foreach ($lines as $raw) {
        $line = trim($raw);
        if ($line === '' || substr($line, 0, 1) === '*') continue;   // blank / comment
        if (substr($line, 0, 1) === '+') continue;                   // continuation
        if (substr($line, 0, 1) !== '.') continue;                   // component line

        // ----- directive line -----
        if (!preg_match('/^\.([a-zA-Z_]+)/', $line, $m)) {
            return 'Malformed directive: ' . substr($line, 0, 60);
        }
        $dot = strtolower($m[1]);

        if (!in_array($dot, $allowed_dots)) {
            return 'Directive not permitted: .' . $dot;
        }

        // .include / .inc / .lib must reference an uploaded model file
        if ($dot === 'include' || $dot === 'inc' || $dot === 'lib') {
            if (!preg_match('/^\.\w+\s+"?([^"\s]+)"?/i', $line, $im)) {
                return 'Malformed include directive';
            }
            $target = basename(str_replace('\\', '/', $im[1]));
            if ($target !== $im[1]) {
                return 'Include must reference a bare filename (no paths): ' . $im[1];
            }
            if (!in_array($target, $uploaded_names)) {
                return 'Include references a file that was not uploaded: ' . $target;
            }
        }

        // cap transient stop time:  .tran <step> <stop> [...]
        if ($dot === 'tran') {
            $parts = preg_split('/\s+/', $line);
            if (count($parts) >= 3) {
                $stop = spice_number($parts[2]);
                if ($stop !== null && $stop > MAX_TRAN_STOP) {
                    return 'Transient stop time exceeds ' . MAX_TRAN_STOP . ' s limit';
                }
            }
        }
    }
    return null;   // ok
}

/** Parse a SPICE number with an engineering suffix ("1m", "10u", "2.5k"). */
function spice_number($s) {
    if (!preg_match('/^([0-9.eE+\-]+)\s*([a-zA-Z]*)$/', trim($s), $m)) return null;
    $v = floatval($m[1]);
    $suf = strtolower($m[2]);
    $mult = 1.0;
    if     ($suf === 'f')                       $mult = 1e-15;
    elseif ($suf === 'p')                       $mult = 1e-12;
    elseif ($suf === 'n')                       $mult = 1e-9;
    elseif ($suf === 'u')                       $mult = 1e-6;
    elseif ($suf === 'm')                       $mult = 1e-3;
    elseif ($suf === 'k')                       $mult = 1e3;
    elseif (substr($suf,0,3) === 'meg')         $mult = 1e6;
    elseif ($suf === 'g')                       $mult = 1e9;
    elseif ($suf === '' || $suf === 's')        $mult = 1.0;
    else return null;   // unknown suffix -> don't guess
    return $v * $mult;
}

function build_multipart($fields, $files, $boundary) {
    $body = '';
    foreach ($fields as $name => $value) {
        $body .= "--" . $boundary . "\r\n";
        $body .= 'Content-Disposition: form-data; name="' . $name . '"' . "\r\n\r\n";
        $body .= $value . "\r\n";
    }
    foreach ($files as $f) {
        $body .= "--" . $boundary . "\r\n";
        $body .= 'Content-Disposition: form-data; name="' . $f['name'] . '"; filename="'
              . $f['filename'] . '"' . "\r\n";
        $body .= "Content-Type: application/octet-stream\r\n\r\n";
        $body .= $f['content'] . "\r\n";
    }
    $body .= "--" . $boundary . "--\r\n";
    return $body;
}

function http_request($url, $method, $body, $content_type) {
    $ch = curl_init($url);
    $headers = array('X-API-KEY: ' . SIM_API_KEY);
    if ($content_type) $headers[] = 'Content-Type: ' . $content_type;
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    curl_setopt($ch, CURLOPT_TIMEOUT, 60);
    $__verify = !(defined('SIM_SSL_VERIFY') && SIM_SSL_VERIFY === false);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, $__verify ? 1 : 0);
    curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, $__verify ? 2 : 0);
    $__ca = dirname(__FILE__) . '/cacert.pem';
    if ($__verify && @is_readable($__ca)) {
        curl_setopt($ch, CURLOPT_CAINFO, $__ca);
    }
    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
    $response = curl_exec($ch);
    $status   = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err      = curl_error($ch);
    curl_close($ch);
    if ($response === false) fail('Upstream request failed: ' . $err, 502);
    return array('status' => $status, 'body' => $response);
}

// ---------------------------------------------------------------- actions ---

$action = isset($_POST['action']) ? $_POST['action'] : '';

if ($action === 'submit') {

    $engine = isset($_POST['engine']) ? $_POST['engine'] : 'D2SPICE';
    // The UI uses display names only; map them to the actual engine here, server-side,
    // so the real engine never appears in the page source or browser network traffic.
    $__engmap = array('D2SPICE' => 'qspice', 'D1SPICE' => 'ngspice');
    if (isset($__engmap[$engine])) $engine = $__engmap[$engine];
    if (!in_array($engine, array('qspice', 'ngspice'))) fail('Unsupported engine', 400);

    $netlist = isset($_POST['netlist']) ? $_POST['netlist'] : '';
    if (trim($netlist) === '') fail('Empty netlist', 400);

    // ---- collect uploaded model files ----
    $models = array();      // array of array('filename','content')
    $names  = array();

    if (isset($_FILES['models']) && is_array($_FILES['models']['name'])) {
        $n = count($_FILES['models']['name']);
        if ($n > MAX_MODELS) fail('Too many model files (max ' . MAX_MODELS . ')', 400);
        for ($i = 0; $i < $n; $i++) {
            if ($_FILES['models']['error'][$i] !== UPLOAD_ERR_OK) continue;
            if ($_FILES['models']['size'][$i] > MAX_MODEL_BYTES) {
                fail('Model file too large: ' . $_FILES['models']['name'][$i], 400);
            }
            $fname   = basename($_FILES['models']['name'][$i]);
            $content = file_get_contents($_FILES['models']['tmp_name'][$i]);
            $models[] = array('filename' => $fname, 'content' => $content);
            $names[]  = $fname;
        }
    }

    // ---- models may also be pasted as text: models_text[name] = content ----
    if (isset($_POST['models_text']) && is_array($_POST['models_text'])) {
        foreach ($_POST['models_text'] as $fname => $content) {
            $fname = basename($fname);
            if ($fname === '' || trim($content) === '') continue;
            if (strlen($content) > MAX_MODEL_BYTES) fail('Model too large: ' . $fname, 400);
            if (count($models) >= MAX_MODELS) fail('Too many model files', 400);
            $models[] = array('filename' => $fname, 'content' => $content);
            $names[]  = $fname;
        }
    }

    // ---- validate ----
    $err = validate_netlist($netlist, $ALLOWED_DOTS, $names);
    if ($err !== null) fail($err, 400);

    // ---- relay ----
    $files = array();
    $files[] = array('name' => 'netlist_file', 'filename' => 'netlist.cir', 'content' => $netlist);
    foreach ($models as $m) {
        $files[] = array('name' => 'model_files', 'filename' => $m['filename'], 'content' => $m['content']);
    }

    $boundary = '----DiscoverEE' . md5(uniqid('', true));
    $body     = build_multipart(array('engine' => $engine), $files, $boundary);

    $res = http_request(SIM_API_BASE . '/simulate', 'POST', $body,
                        'multipart/form-data; boundary=' . $boundary);
    header('HTTP/1.1 ' . $res['status'] . ' OK');
    echo $res['body'];
    exit;

} elseif ($action === 'poll') {

    $job_id = isset($_POST['job_id']) ? $_POST['job_id'] : '';
    if (!preg_match('/^[a-f0-9]{16,64}$/i', $job_id)) fail('Invalid job_id', 400);

    $res = http_request(SIM_API_BASE . '/result/' . $job_id, 'GET', null, null);
    header('HTTP/1.1 ' . $res['status'] . ' OK');
    echo $res['body'];
    exit;

} else {
    fail('Unknown action. Use action=submit or action=poll.', 400);
}
