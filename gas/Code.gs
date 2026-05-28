// ═══════════════════════════════════════════════════════════════════════════════
// 家庭財務儀表板 — GAS 後端
// 架構：密碼 hash 存 Script Properties；Session token 存 sessions sheet；
//        資料（allTx / allTf / accts / snapDate）存 store sheet（key-value JSON）
//        超過 CELL_LIMIT 字元的值自動分塊儲存，讀取時透明還原
//        分塊格式：key__n = 塊數, key__c0, key__c1, ... = 各塊內容
// ═══════════════════════════════════════════════════════════════════════════════

const PROPS = PropertiesService.getScriptProperties();
const TOKEN_EXPIRY_DAYS = 30;
const CELL_LIMIT = 45000;  // Sheets 單格上限 50000，保留 5000 緩衝

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
  const raw = {};
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]) raw[String(rows[i][0])] = String(rows[i][1]);
  }

  // 找出所有分塊 key（有 __n 結尾的就是塊數記錄）
  const chunkBases = new Set(
    Object.keys(raw)
      .filter(k => k.endsWith('__n'))
      .map(k => k.slice(0, -3))
  );

  // 把非塊的 key 直接放入 result
  const result = {};
  for (const [k, v] of Object.entries(raw)) {
    const isChunkMeta  = k.endsWith('__n') && chunkBases.has(k.slice(0, -3));
    const isChunkPiece = /^(.+)__c\d+$/.test(k) && chunkBases.has(k.replace(/__c\d+$/, ''));
    if (!isChunkMeta && !isChunkPiece) result[k] = v;
  }

  // 還原分塊 key
  for (const base of chunkBases) {
    const n = parseInt(raw[base + '__n']) || 0;
    let assembled = '';
    for (let i = 0; i < n; i++) assembled += (raw[base + '__c' + i] || '');
    result[base] = assembled;
  }

  return respond({ ok: true, data: result });
}

function handleSet(key, value) {
  if (!key) return respond({ ok: false, error: 'no key' });

  const strVal = String(value == null ? '' : value);

  // 先清掉此 key 舊的分塊（若有）
  cleanupChunks(key);

  if (strVal.length > CELL_LIMIT) {
    // 切塊儲存
    const chunks = [];
    for (let i = 0; i < strVal.length; i += CELL_LIMIT) {
      chunks.push(strVal.slice(i, i + CELL_LIMIT));
    }
    deleteRawKey(key);  // 若之前是直接存的，刪掉主 key
    setRaw(key + '__n', String(chunks.length));
    for (let i = 0; i < chunks.length; i++) {
      setRaw(key + '__c' + i, chunks[i]);
    }
  } else {
    setRaw(key, strVal);
  }

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

// ─── STORE HELPERS ────────────────────────────────────────────────────────────
function setRaw(key, value) {
  const sheet = getOrCreateSheet('store', ['key', 'value', 'updated_at']);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === key) {
      sheet.getRange(i + 1, 2).setValue(value);
      sheet.getRange(i + 1, 3).setValue(new Date().toISOString());
      return;
    }
  }
  sheet.appendRow([key, value, new Date().toISOString()]);
}

function deleteRawKey(key) {
  const sheet = getSheet('store');
  if (!sheet || sheet.getLastRow() <= 1) return;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === key) { sheet.deleteRow(i + 1); return; }
  }
}

function cleanupChunks(key) {
  const sheet = getSheet('store');
  if (!sheet || sheet.getLastRow() <= 1) return;
  const prefix = key + '__';
  const data = sheet.getDataRange().getValues();
  const rowsToDelete = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]).startsWith(prefix)) rowsToDelete.push(i + 1);
  }
  // 由下往上刪，避免 row index 偏移
  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    sheet.deleteRow(rowsToDelete[i]);
  }
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
