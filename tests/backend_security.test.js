const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function loadBackend() {
  const properties = new Map();
  const context = {
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: key => properties.get(key) || null,
        setProperty: (key, value) => properties.set(key, value),
      }),
    },
    ContentService: {
      MimeType: { JSON: 'json' },
      createTextOutput: text => ({
        text,
        setMimeType() { return this; },
      }),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: () => [1, 2, 3],
      getUuid: () => '11111111-2222-3333-4444-555555555555',
    },
    LockService: {
      getScriptLock: () => ({ waitLock() {}, releaseLock() {} }),
    },
    Logger: { log() {} },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({ getSheetByName: () => null }),
    },
    Date,
    JSON,
    Map,
    Number,
    Object,
    Set,
    String,
    isNaN,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('gas/Code.gs', 'utf8'), context);
  return { context, properties };
}

function responseJson(response) {
  return JSON.parse(response.text);
}

test('密碼設定遺失時保持鎖定，不接受第一位登入者', () => {
  const { context, properties } = loadBackend();
  const result = responseJson(context.handleLogin('attacker-password'));
  assert.deepEqual(result, { ok: false, error: 'auth_not_configured' });
  assert.equal(properties.has('PASSWORD_HASH'), false);
});

test('分塊缺一塊時視為不完整，不回傳半份資料', () => {
  const { context } = loadBackend();
  assert.equal(context.decodeRawValue({ x__n: '2', x__c0: 'left' }, 'x'), null);
  assert.equal(
    context.decodeRawValue({ x__n: '2', x__c0: 'left', x__c1: 'right' }, 'x'),
    'leftright',
  );
});

test('新 active 版本優先，沒有 active 的舊格式仍可讀取', () => {
  const { context } = loadBackend();
  const version = 'allTx__v11111111222233334444555555555555';
  context.readRawStore = () => ({
    allTx: 'legacy-value',
    allTx__active: version,
    [version]: 'new-value',
    allTf__n: '2',
    allTf__c0: 'legacy-',
    allTf__c1: 'chunks',
  });

  const result = responseJson(context.handleGet());
  assert.deepEqual(result.data, {
    allTx: 'new-value',
    allTf: 'legacy-chunks',
  });
});

test('先寫新版本並驗證，最後才切換 active 指標', () => {
  const { context } = loadBackend();
  const raw = { data__active: 'data__v00000000000000000000000000000000' };
  const events = [];
  context.setRaw = (key, value) => {
    events.push(key);
    raw[key] = String(value);
  };
  context.readRawStore = () => ({ ...raw });
  context.cleanupSupersededVersions = () => {};
  context.cleanupStoredBase = () => {};

  context.setValueSafely('data', 'new-value');

  assert.match(events[0], /^data__v[0-9a-f]{32}$/);
  assert.equal(events.at(-1), 'data__active');
  assert.equal(context.decodeRawValue(raw, raw.data__active), 'new-value');
});

test('新版本驗證失敗時不切換舊 active 指標', () => {
  const { context } = loadBackend();
  const oldVersion = 'data__v00000000000000000000000000000000';
  const raw = { data__active: oldVersion, [oldVersion]: 'old-value' };
  context.setRaw = () => {}; // 模擬 Sheets 寫入後讀不到
  context.readRawStore = () => ({ ...raw });
  context.cleanupStoredBase = () => {};

  assert.throws(() => context.setValueSafely('data', 'new-value'));
  assert.equal(raw.data__active, oldVersion);
});
