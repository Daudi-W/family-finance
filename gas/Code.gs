// ═══════════════════════════════════════════════════════════════════════════════
// 家庭財務儀表板 — GAS 後端
// 架構：密碼 hash 存 Script Properties；Session token 存 sessions sheet；
//        資料（allTx / allTf / accts / snapDate）存 store sheet（key-value JSON）
//        超過 CELL_LIMIT 字元的值自動分塊儲存，讀取時透明還原
//        寫入採版本指標：先完整寫入新版本、驗證，再切換 active 指標
// ═══════════════════════════════════════════════════════════════════════════════

const PROPS = PropertiesService.getScriptProperties();
const TOKEN_EXPIRY_DAYS = 30;
const CELL_LIMIT = 45000;  // Sheets 單格上限 50000，保留 5000 緩衝
const ACTIVE_SUFFIX = '__active';

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
    if (action === 'logout') return handleLogout(req.token);

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

  // 設定遺失時保持鎖定，不能讓第一個外部請求接管密碼。
  if (!storedHash) {
    return respond({ ok: false, error: 'auth_not_configured' });
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
  cleanupExpiredSessions(sheet);
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + TOKEN_EXPIRY_DAYS);
  sheet.appendRow([token, expiry.toISOString(), new Date().toISOString()]);
}

function cleanupExpiredSessions(sheet) {
  if (!sheet || sheet.getLastRow() <= 1) return;
  const data = sheet.getDataRange().getValues();
  const now = new Date();
  const rowsToDelete = [];
  for (let i = 1; i < data.length; i++) {
    const expiry = new Date(data[i][1]);
    if (isNaN(expiry.getTime()) || expiry <= now) rowsToDelete.push(i + 1);
  }
  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    sheet.deleteRow(rowsToDelete[i]);
  }
}

function handleLogout(token) {
  const sheet = getSheet('sessions');
  if (!sheet || sheet.getLastRow() <= 1) return respond({ ok: true });
  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0]) === String(token)) sheet.deleteRow(i + 1);
  }
  return respond({ ok: true });
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
  const raw = readRawStore();
  if (Object.keys(raw).length === 0) {
    return respond({ ok: true, data: {} });
  }

  // 先讀新版 active 指標；若新版不完整，保留向舊格式回退的機會。
  const result = {};
  const activeBases = new Set();
  for (const [storageKey, versionBase] of Object.entries(raw)) {
    if (!storageKey.endsWith(ACTIVE_SUFFIX)) continue;
    const logicalKey = storageKey.slice(0, -ACTIVE_SUFFIX.length);
    const value = decodeRawValue(raw, versionBase);
    if (value !== null) {
      result[logicalKey] = value;
      activeBases.add(logicalKey);
    }
  }

  // 相容舊版 key / key__n / key__cN 格式。
  const chunkBases = new Set(
    Object.keys(raw)
      .filter(k => k.endsWith('__n'))
      .map(k => k.slice(0, -3))
      .filter(k => !isVersionStorageKey(k))
  );

  for (const [k, v] of Object.entries(raw)) {
    if (k.endsWith(ACTIVE_SUFFIX) || isVersionStorageKey(k)) continue;
    const isChunkMeta  = k.endsWith('__n') && chunkBases.has(k.slice(0, -3));
    const isChunkPiece = /^(.+)__c\d+$/.test(k) && chunkBases.has(k.replace(/__c\d+$/, ''));
    if (!activeBases.has(k) && !isChunkMeta && !isChunkPiece) result[k] = v;
  }

  for (const base of chunkBases) {
    if (activeBases.has(base)) continue;
    const value = decodeRawValue(raw, base);
    if (value !== null) result[base] = value;
  }

  return respond({ ok: true, data: result });
}

function handleSet(key, value) {
  if (!key) return respond({ ok: false, error: 'no key' });
  setValueSafely(key, value);
  return respond({ ok: true });
}

function handleSetAll(data) {
  if (!data || typeof data !== 'object') {
    return respond({ ok: false, error: 'invalid data' });
  }
  for (const [key, value] of Object.entries(data)) {
    if (!key) throw new Error('invalid key');
    setValueSafely(key, value);
  }
  return respond({ ok: true });
}

// ─── STORE HELPERS ────────────────────────────────────────────────────────────
function setValueSafely(key, value) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const strVal = String(value == null ? '' : value);
    const versionBase = key + '__v' + Utilities.getUuid().replace(/-/g, '').toLowerCase();

    // 新版本完整寫好並讀回驗證之前，舊 active 指標完全不動。
    writeRawValue(versionBase, strVal);
    const raw = readRawStore();
    if (decodeRawValue(raw, versionBase) !== strVal) {
      cleanupStoredBase(versionBase);
      throw new Error('write verification failed');
    }

    // 單一指標切換；此刻之後讀取者才會看到新版本。
    setRaw(key + ACTIVE_SUFFIX, versionBase);

    // 清理失敗只會多留舊副本，不會讓目前資料消失。
    try {
      cleanupSupersededVersions(key, versionBase);
      cleanupStoredBase(key); // 舊版無 active 指標的格式
    } catch (cleanupError) {
      Logger.log('cleanup warning: ' + cleanupError.message);
    }
  } finally {
    lock.releaseLock();
  }
}

function writeRawValue(base, value) {
  if (value.length <= CELL_LIMIT) {
    setRaw(base, value);
    return;
  }
  const chunks = [];
  for (let i = 0; i < value.length; i += CELL_LIMIT) {
    chunks.push(value.slice(i, i + CELL_LIMIT));
  }
  setRaw(base + '__n', String(chunks.length));
  for (let i = 0; i < chunks.length; i++) {
    setRaw(base + '__c' + i, chunks[i]);
  }
}

function decodeRawValue(raw, base) {
  if (Object.prototype.hasOwnProperty.call(raw, base)) return raw[base];
  const n = parseInt(raw[base + '__n'], 10);
  if (!Number.isInteger(n) || n < 1) return null;
  let value = '';
  for (let i = 0; i < n; i++) {
    const pieceKey = base + '__c' + i;
    if (!Object.prototype.hasOwnProperty.call(raw, pieceKey)) return null;
    value += raw[pieceKey];
  }
  return value;
}

function readRawStore() {
  const sheet = getSheet('store');
  if (!sheet || sheet.getLastRow() <= 1) return {};
  const rows = sheet.getDataRange().getValues();
  const raw = {};
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0]) raw[String(rows[i][0])] = String(rows[i][1]);
  }
  return raw;
}

function isVersionStorageKey(key) {
  return /__v[0-9a-f]{32}(?:__(?:n|c\d+))?$/.test(key);
}

function setRaw(key, value) {
  const sheet = getOrCreateSheet('store', ['key', 'value', 'updated_at']);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === key) {
      // 先設純文字格式再寫值，避免 Sheets 把 "2026/07/12" 之類自動轉成日期
      sheet.getRange(i + 1, 2).setNumberFormat('@').setValue(value);
      sheet.getRange(i + 1, 3).setValue(new Date().toISOString());
      return;
    }
  }
  const row = sheet.getLastRow() + 1;
  sheet.getRange(row, 1).setValue(key);
  sheet.getRange(row, 2).setNumberFormat('@').setValue(value);
  sheet.getRange(row, 3).setValue(new Date().toISOString());
}

function cleanupStoredBase(base) {
  const sheet = getSheet('store');
  if (!sheet || sheet.getLastRow() <= 1) return;
  const data = sheet.getDataRange().getValues();
  const rowsToDelete = [];
  for (let i = 1; i < data.length; i++) {
    const key = String(data[i][0]);
    if (key === base || key === base + '__n' || key.startsWith(base + '__c')) {
      rowsToDelete.push(i + 1);
    }
  }
  // 由下往上刪，避免 row index 偏移
  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    sheet.deleteRow(rowsToDelete[i]);
  }
}

function cleanupSupersededVersions(key, keepVersionBase) {
  const sheet = getSheet('store');
  if (!sheet || sheet.getLastRow() <= 1) return;
  const versionPrefix = key + '__v';
  const data = sheet.getDataRange().getValues();
  const rowsToDelete = [];
  for (let i = 1; i < data.length; i++) {
    const storageKey = String(data[i][0]);
    if (
      storageKey.startsWith(versionPrefix) &&
      storageKey !== keepVersionBase &&
      !storageKey.startsWith(keepVersionBase + '__')
    ) {
      rowsToDelete.push(i + 1);
    }
  }
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
