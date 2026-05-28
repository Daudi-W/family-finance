// ═══════════════════════════════════════════════════════════════════════════════
// 家庭財務儀表板 — GAS 後端
// 架構：密碼 hash 存 Script Properties；Session token 存 sessions sheet；
//        資料（allTx / allTf / accts / snapDate）存 store sheet（key-value JSON）
// ═══════════════════════════════════════════════════════════════════════════════

const PROPS = PropertiesService.getScriptProperties();
const TOKEN_EXPIRY_DAYS = 30;

// ─── ENTRY POINT ──────────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    const action = req.action;

    // 登入不需要 token
    if (action === 'login') return handleLogin(req.password);

    // 其他動作都需要有效 token
    if (!validateToken(req.token)) {
      return respond({ ok: false, error: 'unauthorized' });
    }

    if (action === 'get')    return handleGet();
    if (action === 'set')    return handleSet(req.key, req.value);
    if (action === 'setAll') return handleSetAll(req.data);

    return respond({ ok: false, error: 'unknown action' });
  } catch (err) {
    return respond({ ok: false, error: err.message });
  }
}

// GET 只用於健康檢查
function doGet(e) {
  if (e.parameter && e.parameter.ping) {
    return respond({ ok: true, msg: 'pong' });
  }
  return respond({ ok: false, error: 'use POST' });
}

// ─── AUTH ──────────────────────────────────────────────────────────────────────
function handleLogin(password) {
  if (!password) return respond({ ok: false, error: 'no password' });

  const storedHash = PROPS.getProperty('PASSWORD_HASH');

  // 第一次使用：尚未設定密碼 → 直接設定
  if (!storedHash) {
    PROPS.setProperty('PASSWORD_HASH', hashPw(password));
    const token = generateToken();
    storeSession(token);
    return respond({ ok: true, token, firstTime: true });
  }

  if (hashPw(password) !== storedHash) {
    return respond({ ok: false, error: 'wrong password' });
  }

  const token = generateToken();
  storeSession(token);
  return respond({ ok: true, token });
}

function hashPw(pw) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    pw,
    Utilities.Charset.UTF_8
  );
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}

function generateToken() {
  return Utilities.getUuid();
}

function storeSession(token) {
  const sheet = getOrCreateSheet('sessions', ['token', 'expiry', 'created_at']);
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + TOKEN_EXPIRY_DAYS);
  sheet.appendRow([token, expiry.toISOString(), new Date().toISOString()]);
}

function validateToken(token) {
  if (!token) return false;
  const sheet = getSheet('sessions');
  if (!sheet || sheet.getLastRow() <= 1) return false;

  const data = sheet.getDataRange().getValues();
  const now = new Date();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === token) {
      return new Date(data[i][1]) > now;
    }
  }
  return false;
}

// ─── DATA ──────────────────────────────────────────────────────────────────────
function handleGet() {
  const sheet = getSheet('store');
  if (!sheet || sheet.getLastRow() <= 1) {
    return respond({ ok: true, data: {} });
  }

  const rows = sheet.getDataRange().getValues();
  const result = {};
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]) result[rows[i][0]] = rows[i][1];
  }
  return respond({ ok: true, data: result });
}

function handleSet(key, value) {
  if (!key) return respond({ ok: false, error: 'no key' });
  const sheet = getOrCreateSheet('store', ['key', 'value', 'updated_at']);

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      sheet.getRange(i + 1, 3).setValue(new Date().toISOString());
      return respond({ ok: true });
    }
  }
  sheet.appendRow([key, value, new Date().toISOString()]);
  return respond({ ok: true });
}

function handleSetAll(data) {
  if (!data || typeof data !== 'object') {
    return respond({ ok: false, error: 'invalid data' });
  }
  for (const [key, value] of Object.entries(data)) {
    handleSet(key, value);
  }
  return respond({ ok: true });
}

// ─── UTILS ────────────────────────────────────────────────────────────────────
function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}
