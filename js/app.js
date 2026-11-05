'use strict';

const API_ROOT = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const CENTERS = [
  { id: 'gongjin', name: '供金中心', color: '#3478F6', className: 'gongjin' },
  { id: 'innovation', name: '创新中心', color: '#D97706', className: 'innovation' },
  { id: 'shujin', name: '数金中心', color: '#0D9488', className: 'shujin' }
];
const TYPE_LABELS = {
  quarterly: '季度费用发放',
  refund: '费用退回',
  other: '其他费用增加',
  expense: '报销支出',
  opening: '期初余额'
};
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  token: null,
  githubUser: '',
  owner: '',
  repo: '',
  branch: 'main',
  connected: false,
  env: 'demo',
  data: {},
  page: 'dashboard',
  pendingFiles: { payment: [], invoices: [] },
  filters: { expenses: {}, additions: {}, ledger: {} },
  selectedDetail: null,
  report: { mode: 'month', year: String(new Date().getFullYear()), month: String(new Date().getMonth() + 1).padStart(2, '0'), quarter: 'Q4', start: '', end: '' },
  loading: false
};

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function money(cents, showSign = false) {
  const n = Number(cents || 0) / 100;
  const abs = Math.abs(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${showSign && n > 0 ? '+' : n < 0 ? '-' : ''}¥${abs}`;
}
function toCents(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return NaN;
  return Math.round(n * 100);
}
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
function centerById(id) { return CENTERS.find(c => c.id === id) || CENTERS[0]; }
function centerPill(id) { const c = centerById(id); return `<span class="pill ${c.className}">${c.name}</span>`; }
function dateTime() { return new Date().toISOString(); }
function makeId(prefix) {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}${String(d.getHours()).padStart(2,'0')}${String(d.getMinutes()).padStart(2,'0')}${String(d.getSeconds()).padStart(2,'0')}`;
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `${prefix}${stamp}${random}`;
}
function formatDate(date) {
  if (!date) return '—';
  return String(date).replaceAll('-', '.');
}
function envRoot() { return state.env === 'demo' ? 'demo' : 'production'; }
function centerPath(centerId) { return `${envRoot()}/centers/${centerId}.json`; }
function attachmentPath(centerId, recordId, group, fileName) {
  return `${envRoot()}/attachments/${centerId}/${recordId}/${group}/${fileName}`;
}
function currentConfig() {
  return { owner: state.owner, repo: state.repo, branch: state.branch, env: state.env };
}
function savePublicConfig() {
  localStorage.setItem('shendu_gh_repo_config', JSON.stringify({ owner: state.owner, repo: state.repo, branch: state.branch }));
  localStorage.setItem('shendu_active_env', state.env);
}
function restorePublicConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem('shendu_gh_repo_config') || '{}');
    state.owner = saved.owner || '';
    state.repo = saved.repo || '';
    state.branch = saved.branch || 'main';
    state.env = localStorage.getItem('shendu_active_env') === 'production' ? 'production' : 'demo';
    $('#repoOwner').value = state.owner;
    $('#repoName').value = state.repo;
    $('#repoBranch').value = state.branch;
  } catch (_) { /* ignore invalid local config */ }
}
function setBusy(button, busy, text) {
  if (!button) return;
  button.disabled = busy;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = text || '处理中…';
  } else if (button.dataset.originalText) {
    button.textContent = button.dataset.originalText;
    delete button.dataset.originalText;
  }
}
function toast(message, kind = 'success', duration = 3300) {
  const root = $('#toastRoot');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), duration);
}
function showGlobalNotice(message, type = 'info') {
  const box = $('#globalNotice');
  box.className = `global-notice inline-alert ${type}`;
  box.textContent = message;
  box.hidden = false;
}
function hideGlobalNotice() { $('#globalNotice').hidden = true; }
function githubHeaders(accept = 'application/vnd.github+json') {
  return {
    Authorization: `Bearer ${state.token}`,
    Accept: accept,
    'X-GitHub-Api-Version': API_VERSION
  };
}
function encodePath(path) { return path.split('/').map(encodeURIComponent).join('/'); }
async function apiRequest(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) {
    let detail = '';
    try { const j = await res.json(); detail = j.message || ''; } catch (_) { /* non-json response */ }
    const error = new Error(githubErrorMessage(res.status, detail));
    error.status = res.status;
    throw error;
  }
  return res;
}
function githubErrorMessage(status, detail) {
  if (status === 401) return 'GitHub 令牌无效、已过期或权限不足。请重新创建令牌并检查 Contents 读取/写入权限。';
  if (status === 403) return 'GitHub 拒绝访问。可能是令牌权限不足、触发访问频率限制，或仓库策略限制。';
  if (status === 404) return '未找到仓库或文件。请检查仓库所有者、仓库名称、分支和文件路径；私有仓库权限不足时也可能返回 404。';
  if (status === 409 || status === 422) return '保存冲突：数据文件可能已被更新。请刷新数据后重试。';
  if (status === 413) return '文件过大，GitHub 拒绝接收。请压缩文件后再上传。';
  return `GitHub 请求失败（${status}）${detail ? '：' + detail : '。请稍后重试。'}`;
}
async function testGithubConnection(token, owner, repo) {
  const meResponse = await fetch(`${API_ROOT}/user`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': API_VERSION } });
  if (!meResponse.ok) throw new Error(meResponse.status === 401 ? '令牌无效或已过期，请重新检查。' : `读取 GitHub 账号失败（${meResponse.status}）。`);
  const me = await meResponse.json();
  const repoResponse = await fetch(`${API_ROOT}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': API_VERSION } });
  if (!repoResponse.ok) throw new Error(githubErrorMessage(repoResponse.status, '无法访问指定仓库'));
  const repository = await repoResponse.json();
  if (!repository.private) throw new Error('这个仓库不是私有仓库。请先将数据仓库设置为 Private，真实业务资料不能放进公开仓库。');
  if (repository.permissions && repository.permissions.push === false) throw new Error('当前令牌只有读取权限。请将该仓库的 Contents 权限设置为 Read and write。');
  return { user: me.login, defaultBranch: repository.default_branch || 'main' };
}
async function getFileInfo(path) {
  const url = `${API_ROOT}/repos/${encodeURIComponent(state.owner)}/${encodeURIComponent(state.repo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(state.branch)}`;
  const res = await fetch(url, { headers: githubHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) {
    let j = {}; try { j = await res.json(); } catch (_) { /* ignore */ }
    throw new Error(githubErrorMessage(res.status, j.message || ''));
  }
  const item = await res.json();
  if (Array.isArray(item)) throw new Error(`路径 ${path} 指向文件夹而不是文件。`);
  let text = '';
  if (item.content && item.encoding === 'base64') text = decodeBase64Utf8(item.content);
  return { sha: item.sha, text, size: item.size, downloadUrl: item.download_url };
}
async function getJsonFile(path) {
  const info = await getFileInfo(path);
  if (!info) return null;
  let text = info.text;
  if (!text) {
    const rawUrl = `${API_ROOT}/repos/${encodeURIComponent(state.owner)}/${encodeURIComponent(state.repo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(state.branch)}`;
    const raw = await apiRequest(rawUrl, { headers: githubHeaders('application/vnd.github.raw+json') });
    text = await raw.text();
  }
  try { return JSON.parse(text); }
  catch (_) { throw new Error(`数据文件 ${path} 不是有效 JSON。请勿手动编辑该文件。`); }
}
async function putTextFile(path, text, message) {
  const info = await getFileInfo(path);
  const body = { message, content: encodeUtf8Base64(text), branch: state.branch };
  if (info?.sha) body.sha = info.sha;
  const url = `${API_ROOT}/repos/${encodeURIComponent(state.owner)}/${encodeURIComponent(state.repo)}/contents/${encodePath(path)}`;
  await apiRequest(url, { method: 'PUT', headers: { ...githubHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function putBinaryFile(path, file, message) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const body = { message, content: bytesToBase64(bytes), branch: state.branch };
  const url = `${API_ROOT}/repos/${encodeURIComponent(state.owner)}/${encodeURIComponent(state.repo)}/contents/${encodePath(path)}`;
  await apiRequest(url, { method: 'PUT', headers: { ...githubHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function deleteRepoFile(path, message = '清理未关联附件') {
  const info = await getFileInfo(path);
  if (!info?.sha) return;
  const url = `${API_ROOT}/repos/${encodeURIComponent(state.owner)}/${encodeURIComponent(state.repo)}/contents/${encodePath(path)}`;
  await apiRequest(url, { method: 'DELETE', headers: { ...githubHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ message, sha: info.sha, branch: state.branch }) });
}
async function getBinaryFile(path) {
  const url = `${API_ROOT}/repos/${encodeURIComponent(state.owner)}/${encodeURIComponent(state.repo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(state.branch)}`;
  const res = await apiRequest(url, { headers: githubHeaders('application/vnd.github.raw+json') });
  return await res.blob();
}
function encodeUtf8Base64(text) {
  const bytes = new TextEncoder().encode(text);
  return bytesToBase64(bytes);
}
function bytesToBase64(bytes) {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) binary += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(binary);
}
function decodeBase64Utf8(value) {
  const binary = atob(String(value).replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
function emptyCenterData(center) {
  return {
    schemaVersion: 1,
    centerId: center.id,
    centerName: center.name,
    openingBalance: null,
    expenses: [],
    additions: [],
    updatedAt: dateTime()
  };
}
function demoSeed(center) {
  const now = dateTime();
  const base = emptyCenterData(center);
  base.openingBalance = { amountCents: ({ gongjin: 3000000, innovation: 2000000, shujin: 1500000 })[center.id], effectiveDate: '2026-11-01', createdAt: '2026-11-01T00:00:00.000Z' };
  const seed = {
    gongjin: {
      expenses: [
        { id: 'BX20261102001', date: '2026-11-02', matter: '客户接待', person: '演示张三', amountCents: 200000, remark: '虚拟演示记录', status: 'active', attachments: { payment: [], invoices: [] }, createdAt: '2026-11-02T02:00:00.000Z' },
        { id: 'BX20261103002', date: '2026-11-03', matter: '业务协调费用', person: '演示李四', amountCents: 300000, remark: '虚拟演示记录', status: 'active', attachments: { payment: [], invoices: [] }, createdAt: '2026-11-03T03:00:00.000Z' }
      ], additions: [{ id: 'FY20261101001', date: '2026-11-01', type: 'quarterly', quarterYear: '2026', quarter: 'Q4', amountCents: 1000000, remark: '演示第四季度费用', status: 'active', attachments: { files: [] }, createdAt: '2026-11-01T01:00:00.000Z' }]
    },
    innovation: {
      expenses: [
        { id: 'BX20261102003', date: '2026-11-02', matter: '业务招待', person: '演示王五', amountCents: 120000, remark: '虚拟演示记录', status: 'active', attachments: { payment: [], invoices: [] }, createdAt: '2026-11-02T04:00:00.000Z' },
        { id: 'BX20261103004', date: '2026-11-03', matter: '活动物料', person: '演示赵六', amountCents: 80000, remark: '虚拟演示记录', status: 'active', attachments: { payment: [], invoices: [] }, createdAt: '2026-11-03T04:00:00.000Z' }
      ], additions: [{ id: 'FY20261101002', date: '2026-11-01', type: 'quarterly', quarterYear: '2026', quarter: 'Q4', amountCents: 800000, remark: '演示第四季度费用', status: 'active', attachments: { files: [] }, createdAt: '2026-11-01T01:30:00.000Z' }]
    },
    shujin: {
      expenses: [
        { id: 'BX20261102005', date: '2026-11-02', matter: '项目走访', person: '演示周七', amountCents: 90000, remark: '虚拟演示记录', status: 'active', attachments: { payment: [], invoices: [] }, createdAt: '2026-11-02T05:00:00.000Z' },
        { id: 'BX20261103006', date: '2026-11-03', matter: '差旅费用', person: '演示郑八', amountCents: 150000, remark: '虚拟演示记录', status: 'active', attachments: { payment: [], invoices: [] }, createdAt: '2026-11-03T05:00:00.000Z' }
      ], additions: [{ id: 'FY20261101003', date: '2026-11-01', type: 'quarterly', quarterYear: '2026', quarter: 'Q4', amountCents: 500000, remark: '演示第四季度费用', status: 'active', attachments: { files: [] }, createdAt: '2026-11-01T02:00:00.000Z' }]
    }
  };
  base.expenses = seed[center.id].expenses;
  base.additions = seed[center.id].additions;
  return base;
}
function balanceFor(data, endDate = '9999-12-31') {
  if (!data?.openingBalance) return null;
  if (data.openingBalance.effectiveDate > endDate) return null;
  let balance = Number(data.openingBalance.amountCents || 0);
  for (const a of (data.additions || [])) if (a.status !== 'voided' && a.date <= endDate) balance += Number(a.amountCents || 0);
  for (const e of (data.expenses || [])) if (e.status !== 'voided' && e.date <= endDate) balance -= Number(e.amountCents || 0);
  return balance;
}
function allCenterData() { return CENTERS.map(c => ({ center: c, data: state.data[c.id] || emptyCenterData(c) })); }
function allTransactions(centerId = 'all') {
  const tx = [];
  for (const { center, data } of allCenterData()) {
    if (centerId !== 'all' && center.id !== centerId) continue;
    if (data.openingBalance) tx.push({ id: `OPEN-${center.id}`, date: data.openingBalance.effectiveDate, centerId: center.id, type: 'opening', desc: '系统期初余额', person: '超级管理员', change: Number(data.openingBalance.amountCents || 0), createdAt: data.openingBalance.createdAt || '2000-01-01T00:00:00.000Z', record: data.openingBalance, status: 'active' });
    for (const a of data.additions || []) {
      tx.push({ id: a.id, date: a.date, centerId: center.id, type: a.type, desc: additionDescription(a), person: '超级管理员', change: a.status === 'voided' ? 0 : Number(a.amountCents || 0), createdAt: a.createdAt || '', record: a, status: a.status || 'active' });
    }
    for (const e of data.expenses || []) {
      tx.push({ id: e.id, date: e.date, centerId: center.id, type: 'expense', desc: e.matter, person: e.person, change: e.status === 'voided' ? 0 : -Number(e.amountCents || 0), createdAt: e.createdAt || '', record: e, status: e.status || 'active' });
    }
  }
  const chronological = [...tx].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const running = {};
  for (const t of chronological) {
    const d = state.data[t.centerId] || emptyCenterData(centerById(t.centerId));
    if (!Object.prototype.hasOwnProperty.call(running, t.centerId)) running[t.centerId] = Number(d.openingBalance?.amountCents || 0);
    if (t.type === 'opening') running[t.centerId] = Number(t.change || 0);
    else running[t.centerId] += Number(t.change || 0);
    t.balanceAfter = running[t.centerId];
  }
  return chronological.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}
function additionDescription(item) {
  if (item.type === 'quarterly') return `${item.quarterYear || ''}年${quarterLabel(item.quarter)}费用`;
  if (item.type === 'refund') return item.reason || '费用退回';
  return item.reason || '其他费用增加';
}
function quarterLabel(q) { return ({ Q1: '第一季度', Q2: '第二季度', Q3: '第三季度', Q4: '第四季度' })[q] || q || ''; }
function getCenterData(centerId) { return state.data[centerId] || emptyCenterData(centerById(centerId)); }
function totalBalance(endDate = '9999-12-31') {
  const values = CENTERS.map(c => balanceFor(getCenterData(c.id), endDate));
  if (values.some(v => v === null)) return null;
  return values.reduce((a, b) => a + b, 0);
}
function dateRangeFromReport() {
  const { mode, year, month, quarter, start, end } = state.report;
  if (mode === 'month') {
    const last = new Date(Number(year), Number(month), 0).getDate();
    return [`${year}-${month}-01`, `${year}-${month}-${String(last).padStart(2, '0')}`];
  }
  if (mode === 'quarter') {
    const ranges = { Q1: ['01-01', '03-31'], Q2: ['04-01', '06-30'], Q3: ['07-01', '09-30'], Q4: ['10-01', '12-31'] };
    return [`${year}-${ranges[quarter][0]}`, `${year}-${ranges[quarter][1]}`];
  }
  if (mode === 'year') return [`${year}-01-01`, `${year}-12-31`];
  return [start || today(), end || today()];
}
function periodLabel() {
  const { mode, year, month, quarter, start, end } = state.report;
  if (mode === 'month') return `${year}年${Number(month)}月`;
  if (mode === 'quarter') return `${year}年${quarterLabel(quarter)}`;
  if (mode === 'year') return `${year}年度`;
  return `${formatDate(start)} — ${formatDate(end)}`;
}
async function loadAllData() {
  const next = {};
  for (const c of CENTERS) {
    const file = await getJsonFile(centerPath(c.id));
    next[c.id] = file ? normalizeCenterData(file, c) : emptyCenterData(c);
  }
  state.data = next;
}
function normalizeCenterData(input, center) {
  const data = input && typeof input === 'object' ? input : {};
  return {
    schemaVersion: 1,
    centerId: center.id,
    centerName: center.name,
    openingBalance: data.openingBalance || null,
    expenses: Array.isArray(data.expenses) ? data.expenses : [],
    additions: Array.isArray(data.additions) ? data.additions : [],
    updatedAt: data.updatedAt || ''
  };
}
async function saveCenterData(centerId, data, commitMessage) {
  data.updatedAt = dateTime();
  await putTextFile(centerPath(centerId), JSON.stringify(data, null, 2), commitMessage);
  state.data[centerId] = data;
}
async function initializeDemoData() {
  if (state.env !== 'demo') throw new Error('当前不是演示账本。');
  const missing = [];
  for (const c of CENTERS) if (!await getFileInfo(centerPath(c.id))) missing.push(c);
  if (missing.length !== CENTERS.length) throw new Error('演示账本中已有部分数据文件，为避免覆盖数据，本次未自动初始化。请刷新后检查各中心数据。');
  for (const c of CENTERS) await putTextFile(centerPath(c.id), JSON.stringify(demoSeed(c), null, 2), `初始化${c.name}演示账本`);
  await loadAllData();
  renderAll();
  toast('演示账本已初始化，全部为虚拟数据。');
}
async function initializeProduction(values) {
  if (state.env !== 'production') throw new Error('请先切换到正式账本。');
  const existing = [];
  for (const c of CENTERS) if (await getFileInfo(centerPath(c.id))) existing.push(c.name);
  if (existing.length) throw new Error(`正式账本中已有数据文件（${existing.join('、')}），不能重复初始化。`);
  for (const c of CENTERS) {
    const amount = toCents(values[c.id]);
    if (!Number.isFinite(amount) || amount < 0) throw new Error(`${c.name}期初余额无效。`);
    const data = emptyCenterData(c);
    data.openingBalance = { amountCents: amount, effectiveDate: values.date, createdAt: dateTime() };
    await putTextFile(centerPath(c.id), JSON.stringify(data, null, 2), `初始化${c.name}正式期初余额`);
  }
  await loadAllData();
  renderAll();
  toast('正式账本期初余额初始化完成。');
}
async function uploadAttachment(file, centerId, recordId, group) {
  if (file.size > MAX_FILE_BYTES) throw new Error(`附件「${file.name}」超过10MB，请压缩后上传。`);
  const extension = (file.name.split('.').pop() || 'file').toLowerCase().replace(/[^a-z0-9]/g, '') || 'file';
  const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const path = attachmentPath(centerId, recordId, group, safeName);
  await putBinaryFile(path, file, `上传${group === 'payment' ? '付款凭证' : group === 'invoices' ? '发票附件' : '相关附件'} ${recordId}`);
  return { name: file.name, path, size: file.size, mime: file.type || 'application/octet-stream' };
}
async function uploadPendingFiles(centerId, recordId, groups) {
  const uploaded = [];
  const refs = { payment: [], invoices: [], files: [] };
  try {
    for (const group of groups) {
      for (const file of (state.pendingFiles[group] || [])) {
        const ref = await uploadAttachment(file, centerId, recordId, group);
        refs[group].push(ref);
        uploaded.push(ref.path);
      }
    }
    return refs;
  } catch (err) {
    for (const path of uploaded.reverse()) {
      try { await deleteRepoFile(path, '清理未完成记录的附件'); } catch (_) { /* best effort cleanup */ }
    }
    throw err;
  }
}
function setPendingFiles(group, files) {
  const accepted = [];
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) { toast(`文件 ${file.name} 超过10MB，未加入。`, 'error'); continue; }
    if (group === 'payment' && !file.type.startsWith('image/')) { toast(`付款凭证只接受图片：${file.name}`, 'error'); continue; }
    if (group === 'invoices' && !(file.type.startsWith('image/') || file.type === 'application/pdf')) { toast(`发票只接受图片或PDF：${file.name}`, 'error'); continue; }
    accepted.push(file);
  }
  state.pendingFiles[group] = [...state.pendingFiles[group], ...accepted];
  renderFileList(group);
}
function renderFileList(group) {
  const container = $(`#${group}FileList`);
  if (!container) return;
  container.innerHTML = state.pendingFiles[group].map((f, i) => `<div class="file-chip"><span class="attachment-icon">${f.type === 'application/pdf' ? 'PDF' : 'IMG'}</span><span class="file-name">${escapeHtml(f.name)} · ${formatBytes(f.size)}</span><button type="button" data-action="remove-pending" data-group="${group}" data-index="${i}" aria-label="移除附件">×</button></div>`).join('');
}
function formatBytes(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
function renderAll() {
  if (!state.connected) return;
  $('#connectionScreen').hidden = true;
  $('#appShell').hidden = false;
  $('#sidebarConnection').textContent = `${state.githubUser} · 已连接`;
  $('#topConnectionButton').textContent = 'GitHub 已连接 · 重新授权';
  $('#environmentBadge').textContent = state.env === 'demo' ? '演示账本' : '正式账本';
  $('#environmentBadge').className = `environment-badge ${state.env}`;
  renderDashboard();
  renderExpenses();
  renderAdditions();
  renderLedger();
  renderReports();
  renderSettings();
  showPage(state.page, false);
}
function showPage(page, updateNav = true) {
  state.page = page;
  $$('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  const title = ({ dashboard: '费用总览', expenses: '支出记录', additions: '费用增加', ledger: '资金流水', reports: '统计报表', settings: '系统管理' })[page] || '费用总览';
  $('#breadcrumbCurrent').textContent = title;
  if (updateNav) $('#sidebar').classList.remove('open');
}
function pageHeading(title, subtitle, actions = '') {
  return `<div class="page-heading"><div><div class="eyebrow-dark">SHENDU DIGITAL · EXPENSE MANAGEMENT</div><h1>${title}</h1><p>${subtitle}</p></div><div class="page-actions">${actions}</div></div>`;
}
function renderDashboard() {
  const dataExists = CENTERS.some(c => state.data[c.id]?.openingBalance);
  const total = totalBalance();
  const recent = allTransactions().filter(t => t.type !== 'opening' && t.status !== 'voided').slice(0, 8);
  const centerCards = CENTERS.map(c => {
    const d = getCenterData(c.id);
    const b = balanceFor(d);
    const spent = d.expenses.filter(e => e.status !== 'voided').reduce((s, e) => s + Number(e.amountCents || 0), 0);
    return `<div class="center-card ${c.className}"><span class="center-tag" style="background:${c.color}">${c.name}</span><div class="center-balance">${b === null ? '未初始化' : money(b)}</div><div class="center-caption">当前剩余费用</div><div class="center-detail"><span>累计支出（系统上线后）</span><strong class="center-spent">${money(spent)}</strong></div></div>`;
  }).join('');
  $('#page-dashboard').innerHTML = `${pageHeading('费用管理工作台', '以日常记账为中心，快速掌握三个中心的剩余费用。', `<button class="btn btn-outline btn-sm" data-action="reload-data">刷新数据</button>`)}
    ${state.env === 'demo' ? `<div class="inline-alert warn" style="margin-bottom:16px">当前为演示账本，所有示例姓名和金额均为虚拟数据。未经公司批准，不要在演示账本上传真实付款凭证或发票。</div>` : `<div class="inline-alert info" style="margin-bottom:16px">当前为正式账本。请确认公司已批准将真实业务资料存放在 GitHub 私有仓库中。</div>`}
    ${!dataExists ? `<div class="empty-state" style="margin-bottom:18px"><strong>${state.env === 'demo' ? '演示账本尚未初始化' : '正式账本尚未开账'}</strong><p>${state.env === 'demo' ? '可以先载入虚拟演示数据，体验完整记账流程。' : '请在系统管理中确认公司数据存储要求，并设置三个中心的期初余额。'}</p>${state.env === 'demo' ? `<button class="btn btn-primary" data-action="init-demo">初始化演示数据</button>` : `<button class="btn btn-primary" data-action="go-settings">前往期初余额设置</button>`}</div>` : ''}
    <div class="summary-grid"><div class="metric-card" style="background:linear-gradient(135deg,#263f68,#17243a)"><div class="metric-label">集团当前剩余费用</div><div class="metric-value">${total === null ? '待初始化' : money(total)}</div><div class="metric-sub">三个中心独立核算 · 余额自动滚动结转</div></div><div class="card"><h2 class="card-title">日常快捷操作</h2><div class="quick-actions"><button class="quick-action blue" data-action="go-expense"><strong>＋ 新增报销</strong><small>录入打款信息及附件</small></button><button class="quick-action green" data-action="go-addition"><strong>＋ 费用增加</strong><small>季度发放、退回及其他增加</small></button></div></div></div>
    <div class="section-head"><div><h2>三个费用中心</h2><p>三个中心颜色固定，分别核算，互不抵扣。</p></div><span class="pill neutral">中心余额一览</span></div>
    <div class="center-grid">${centerCards}</div>
    <div class="dashboard-lower"><div class="card"><h2 class="card-title">最近资金变动</h2><div class="recent-list">${recent.length ? recent.map(t => `<div class="recent-row"><div class="recent-main"><strong>${escapeHtml(t.desc)}</strong><small>${formatDate(t.date)} · ${centerById(t.centerId).name} · ${escapeHtml(t.person || '—')}</small></div><div style="text-align:right"><div class="${t.change >= 0 ? 'money-positive' : 'money-negative'}">${money(t.change, true)}</div><small class="muted">余额 ${money(t.balanceAfter)}</small></div></div>`).join('') : `<div class="table-empty">暂无资金记录</div>`}</div></div><div class="card"><h2 class="card-title">记账规则提醒</h2><div class="recent-list"><div class="recent-row"><div class="recent-main"><strong>按实际打款日期记账</strong><small>不记录实际消费发生日期。</small></div><span class="pill blue">日期</span></div><div class="recent-row"><div class="recent-main"><strong>费用跨季度自动结转</strong><small>无需每季度手动新增结转费用。</small></div><span class="pill green">自动</span></div><div class="recent-row"><div class="recent-main"><strong>允许余额为负数</strong><small>超出可用余额时提示，但不阻止记账。</small></div><span class="pill orange">提醒</span></div><div class="recent-row"><div class="recent-main"><strong>错误资金记录采用作废处理</strong><small>作废后不参与余额计算，保留原记录。</small></div><span class="pill neutral">留痕</span></div></div></div></div>`;
}
function centerChoiceHtml(selected) {
  return `<div class="center-choice">${CENTERS.map(c => `<button type="button" class="${c.className} ${selected === c.id ? 'selected' : ''}" data-action="select-center" data-center="${c.id}">${c.name}</button>`).join('')}</div>`;
}
function attachmentInputs() {
  return `<div class="form-section"><div><h3>付款凭证</h3><p class="section-hint">支持多张图片，例如微信、支付宝或银行付款截图。</p></div><label class="upload-zone" for="paymentFiles"><span style="font-size:24px;color:#3478f6">▧</span><strong>选择付款截图</strong><small>图片格式 · 单个文件不超过10MB</small><input id="paymentFiles" type="file" accept="image/*" multiple hidden></label><div id="paymentFileList" class="file-list"></div></div><hr class="section-divider"><div class="form-section"><div><h3>发票附件</h3><p class="section-hint">支持多张图片或 PDF；发票信息不做结构化识别。</p></div><label class="upload-zone" for="invoiceFiles"><span style="font-size:24px;color:#0d9488">▤</span><strong>选择发票图片 / PDF</strong><small>图片或 PDF 格式 · 单个文件不超过10MB · 可不上传</small><input id="invoiceFiles" type="file" accept="image/*,application/pdf" multiple hidden></label><div id="invoicesFileList" class="file-list"></div></div>`;
}
function renderExpenses() {
  const d = state.filters.expenses || {};
  const centerId = d.center || 'all';
  const search = d.search || '';
  const from = d.from || '';
  const to = d.to || '';
  const rows = allCenterData().flatMap(({ center, data }) => (data.expenses || []).map(r => ({ ...r, centerId: center.id })))
    .filter(r => centerId === 'all' || r.centerId === centerId)
    .filter(r => !from || r.date >= from).filter(r => !to || r.date <= to)
    .filter(r => `${r.id} ${r.matter} ${r.person}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  $('#page-expenses').innerHTML = `${pageHeading('支出记录', '查看三个中心全部报销记录，支持多条件筛选和附件查看。', `<button class="btn btn-outline btn-sm" data-action="export-expenses">导出当前筛选</button><button class="btn btn-outline btn-sm" data-action="export-all-expenses">导出全部</button><button class="btn btn-primary btn-sm" data-action="go-expense">＋ 新增报销</button>`)}
    <div class="toolbar"><div class="field"><label>所属中心</label><select id="expenseCenter"><option value="all">全部中心</option>${CENTERS.map(c => `<option value="${c.id}" ${centerId === c.id ? 'selected' : ''}>${c.name}</option>`).join('')}</select></div><div class="field search"><label>关键词搜索</label><input id="expenseSearch" value="${escapeHtml(search)}" placeholder="事项、报销人、记录编号"></div><div class="field"><label>开始日期</label><input id="expenseFrom" type="date" value="${escapeHtml(from)}"></div><div class="field"><label>结束日期</label><input id="expenseTo" type="date" value="${escapeHtml(to)}"></div><button class="btn btn-outline btn-sm" data-action="filter-expenses">筛选</button><button class="btn btn-outline btn-sm" data-action="clear-expense-filter">重置</button></div>
    <div class="table-card"><div class="table-wrap"><table class="data-table"><thead><tr><th>打款日期</th><th>所属中心</th><th>用款事项</th><th>报销人</th><th class="right">报销金额</th><th>附件</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows.length ? rows.map(r => `<tr class="${r.status === 'voided' ? 'voided' : ''}"><td>${formatDate(r.date)}</td><td>${centerPill(r.centerId)}</td><td>${escapeHtml(r.matter)}</td><td>${escapeHtml(r.person)}</td><td class="right amount ${r.status === 'voided' ? '' : 'money-negative'}">${money(r.amountCents)}</td><td>付款 ${r.attachments?.payment?.length || 0} / 发票 ${r.attachments?.invoices?.length || 0}</td><td>${r.status === 'voided' ? '<span class="status-void">已作废</span>' : '<span class="pill green">有效</span>'}</td><td><button class="record-link" data-action="view-record" data-center="${r.centerId}" data-id="${r.id}" data-kind="expense">详情</button> ${r.status === 'voided' ? '' : `<button class="record-link" data-action="void-record" data-center="${r.centerId}" data-id="${r.id}" data-kind="expense">作废</button>`}</td></tr>`).join('') : `<tr><td colspan="8" class="table-empty">没有找到符合条件的支出记录</td></tr>`}</tbody></table></div><div class="table-foot"><span>共 ${rows.length} 笔 · 当前筛选金额 ${money(rows.filter(r => r.status !== 'voided').reduce((s,r)=>s+r.amountCents,0))}</span><button class="record-link" data-action="export-expenses">导出当前筛选 CSV</button></div></div>`;
}
function renderAdditions() {
  const d = state.filters.additions || {};
  const centerId = d.center || 'all';
  const type = d.type || 'all';
  const search = d.search || '';
  const rows = allCenterData().flatMap(({ center, data }) => (data.additions || []).map(r => ({ ...r, centerId: center.id })))
    .filter(r => centerId === 'all' || r.centerId === centerId)
    .filter(r => type === 'all' || r.type === type)
    .filter(r => `${r.id} ${additionDescription(r)} ${r.reason || ''}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
  $('#page-additions').innerHTML = `${pageHeading('费用增加', '独立记录季度费用发放、费用退回和其他费用增加。', `<button class="btn btn-outline btn-sm" data-action="export-additions">导出当前筛选</button><button class="btn btn-outline btn-sm" data-action="export-all-additions">导出全部</button><button class="btn btn-primary btn-sm" data-action="go-addition">＋ 新增费用</button>`)}
    <div class="toolbar"><div class="field"><label>所属中心</label><select id="additionCenter"><option value="all">全部中心</option>${CENTERS.map(c=>`<option value="${c.id}" ${centerId===c.id?'selected':''}>${c.name}</option>`).join('')}</select></div><div class="field"><label>增加类型</label><select id="additionType"><option value="all">全部类型</option><option value="quarterly" ${type==='quarterly'?'selected':''}>季度费用发放</option><option value="refund" ${type==='refund'?'selected':''}>费用退回</option><option value="other" ${type==='other'?'selected':''}>其他费用增加</option></select></div><div class="field search"><label>关键词</label><input id="additionSearch" value="${escapeHtml(search)}" placeholder="事项、记录编号、原因"></div><button class="btn btn-outline btn-sm" data-action="filter-additions">筛选</button><button class="btn btn-outline btn-sm" data-action="clear-addition-filter">重置</button></div>
    <div class="table-card"><div class="table-wrap"><table class="data-table"><thead><tr><th>实际增加日期</th><th>所属中心</th><th>增加类型</th><th>增加事项</th><th class="right">增加金额</th><th>关联原支出</th><th>状态</th><th>操作</th></tr></thead><tbody>${rows.length?rows.map(r=>`<tr class="${r.status==='voided'?'voided':''}"><td>${formatDate(r.date)}</td><td>${centerPill(r.centerId)}</td><td>${escapeHtml(TYPE_LABELS[r.type]||r.type)}</td><td>${escapeHtml(additionDescription(r))}</td><td class="right amount ${r.status==='voided'?'':'money-positive'}">${money(r.amountCents)}</td><td>${escapeHtml(r.linkedExpenseId||'—')}</td><td>${r.status==='voided'?'<span class="status-void">已作废</span>':'<span class="pill green">有效</span>'}</td><td><button class="record-link" data-action="view-record" data-center="${r.centerId}" data-id="${r.id}" data-kind="addition">详情</button> ${r.status==='voided'?'':`<button class="record-link" data-action="void-record" data-center="${r.centerId}" data-id="${r.id}" data-kind="addition">作废</button>`}</td></tr>`).join(''):`<tr><td colspan="8" class="table-empty">暂无费用增加记录</td></tr>`}</tbody></table></div><div class="table-foot"><span>共 ${rows.length} 笔 · 当前筛选增加金额 ${money(rows.filter(r=>r.status!=='voided').reduce((s,r)=>s+r.amountCents,0))}</span><button class="record-link" data-action="export-additions">导出当前筛选 CSV</button></div></div>`;
}
function balanceLabel(centerId) { const b=balanceFor(getCenterData(centerId)); return b === null ? '未初始化' : money(b); }
function renderExpenseForm() {
  state.pendingFiles = { payment: [], invoices: [] };
  $('#page-expenses').innerHTML = `${pageHeading('新增报销', '记录实际打款日期、用款事项、报销人和金额。', `<button class="btn btn-outline btn-sm" data-action="show-expense-list">返回消费记录</button>`)}
    <div class="form-layout"><div class="card form-card"><form id="expenseForm" class="form-grid-single">
      <div class="form-section"><h3>01 · 基本信息</h3><div class="field"><label>所属费用中心 *</label>${centerChoiceHtml('gongjin')}<input type="hidden" id="expenseCenterId" value="gongjin"></div><div class="field"><label for="expenseDate">报销打款日期 *</label><input id="expenseDate" type="date" value="${today()}" required></div><div class="field"><label for="expenseMatter">用款事项 *</label><input id="expenseMatter" maxlength="120" placeholder="例如：客户接待、差旅费用" required></div><div class="field"><label for="expensePerson">报销人 *</label><input id="expensePerson" maxlength="40" placeholder="请输入报销人姓名" required></div><div class="field"><label for="expenseAmount">报销金额（元）*</label><input id="expenseAmount" type="number" min="0.01" step="0.01" placeholder="请输入实际报销金额" required></div></div>
      <hr class="section-divider">${attachmentInputs()}<hr class="section-divider"><div class="form-section"><h3>04 · 补充说明</h3><textarea id="expenseRemark" maxlength="500" placeholder="选填：其他说明"></textarea></div><div class="form-actions"><button class="btn btn-primary" type="submit" id="saveExpenseButton">保存报销记录</button><button class="btn btn-outline" type="button" data-action="show-expense-list">取消</button></div></form></div>
      <aside class="side-panel"><div class="balance-preview"><small>所选中心当前余额</small><strong id="expenseBalancePreview">${balanceLabel('gongjin')}</strong><p>保存后自动扣减所选中心余额；允许出现负数。</p></div><div class="hint-card"><strong>录入提醒</strong>日期填写你实际向报销人打款的日期，不需要填写消费发生日期。付款凭证与发票分开上传。</div><div class="hint-card"><strong>附件要求</strong>付款凭证只接受图片；发票接受图片和 PDF。单个文件限制 10MB，建议清晰、完整上传。</div><div class="hint-card"><strong>错误处理</strong>已保存的资金记录不直接删除。金额或中心错误时，先作废原记录，再重新录入正确记录。</div></aside></div>`;
}
function renderAdditionForm() {
  state.pendingFiles = { payment: [], invoices: [] };
  $('#page-additions').innerHTML = `${pageHeading('新增费用增加', '费用发放、退回和其他增加分别建账，不修改原支出记录。', `<button class="btn btn-outline btn-sm" data-action="show-addition-list">返回费用增加列表</button>`)}
    <div class="form-layout"><div class="card form-card"><form id="additionForm" class="form-grid-single">
      <div class="form-section"><h3>01 · 增加类型</h3><div class="field"><label for="additionTypeInput">增加类型 *</label><select id="additionTypeInput"><option value="quarterly">季度费用发放</option><option value="refund">费用退回</option><option value="other">其他费用增加</option></select></div><div class="field"><label>所属费用中心 *</label>${centerChoiceHtml('gongjin')}<input type="hidden" id="additionCenterId" value="gongjin"></div><div class="field"><label for="additionDate">实际增加日期 *</label><input id="additionDate" type="date" value="${today()}" required></div><div class="field"><label for="additionAmount">增加金额（元）*</label><input id="additionAmount" type="number" min="0.01" step="0.01" placeholder="请输入增加金额" required></div>
      <div id="quarterFields" class="form-grid-two"><div class="field"><label for="quarterYear">所属年份 *</label><input id="quarterYear" type="number" min="2000" max="2100" value="${new Date().getFullYear()}"></div><div class="field"><label for="quarterValue">所属季度 *</label><select id="quarterValue"><option value="Q1">第一季度</option><option value="Q2">第二季度</option><option value="Q3">第三季度</option><option value="Q4" selected>第四季度</option></select></div></div>
      <div id="refundFields" class="field" hidden><label for="linkedExpense">关联原支出（选填）</label><select id="linkedExpense"><option value="">不关联原支出</option>${CENTERS.flatMap(c=>(getCenterData(c.id).expenses||[]).filter(e=>e.status!=='voided').map(e=>`<option value="${escapeHtml(e.id)}" data-center="${c.id}">${c.name} · ${escapeHtml(e.matter)} · ${money(e.amountCents)}</option>`)).join('')}</select><small class="help">能找到原支出就关联；找不到也可以单独增加，支持部分退回。</small></div>
      <div id="reasonFields" class="field" hidden><label for="additionReason">增加事项及原因 *</label><input id="additionReason" maxlength="120" placeholder="例如：临时费用补充、余额补充"></div>
      </div>
      <hr class="section-divider"><div class="form-section"><h3>02 · 备注说明</h3><textarea id="additionRemark" maxlength="500" placeholder="选填：补充说明"></textarea></div><hr class="section-divider">${attachmentInputs()}<div class="form-actions"><button class="btn btn-primary" type="submit" id="saveAdditionButton">保存费用增加</button><button class="btn btn-outline" type="button" data-action="show-addition-list">取消</button></div></form></div><aside class="side-panel"><div class="balance-preview"><small>所选中心当前余额</small><strong id="additionBalancePreview">${balanceLabel('gongjin')}</strong><p>保存后自动增加所选中心余额。</p></div><div class="hint-card"><strong>季度发放</strong>实际增加日期和费用所属季度分别记录；统计按实际增加日期计算。</div><div class="hint-card"><strong>费用退回</strong>可关联原支出，也可不关联。退回不修改原报销金额。</div><div class="hint-card"><strong>自动结转</strong>无需手动录入季度结转，剩余余额跨季度持续累计。</div></aside></div>`;
}
function buildLedgerRows(filters = {}) {
  const { center = 'all', type = 'all', from = '', to = '', search = '' } = filters;
  return allTransactions(center).filter(t => t.status !== 'voided')
    .filter(t => type === 'all' || t.type === type)
    .filter(t => !from || t.date >= from).filter(t => !to || t.date <= to)
    .filter(t => `${t.id} ${t.desc} ${t.person}`.toLowerCase().includes(search.toLowerCase()));
}
function renderLedger() {
  const f = state.filters.ledger || {};
  const rows = buildLedgerRows(f);
  let carryCard = '';
  if (f.from && f.to) {
    const selectedCenters = f.center && f.center !== 'all' ? CENTERS.filter(c => c.id === f.center) : CENTERS;
    const prior = new Date(`${f.from}T00:00:00`); prior.setDate(prior.getDate() - 1);
    const priorDate = `${prior.getFullYear()}-${String(prior.getMonth()+1).padStart(2,'0')}-${String(prior.getDate()).padStart(2,'0')}`;
    const carry = selectedCenters.map(c => { const d=getCenterData(c.id); const v=d.openingBalance && d.openingBalance.effectiveDate < f.from ? balanceFor(d, priorDate) : (d.openingBalance ? 0 : null); return {c,v}; });
    const valid = carry.every(x => x.v !== null);
    const sum = carry.reduce((a,x)=>a+(x.v||0),0);
    carryCard = `<div class="card carry-card"><div><strong>统计期间承接余额</strong><small>截至 ${formatDate(priorDate)} · ${f.center && f.center!=='all' ? centerById(f.center).name : '集团三个中心'}</small></div><b>${valid?money(sum):'部分中心尚未初始化'}</b></div>`;
  }
  $('#page-ledger').innerHTML = `${pageHeading('资金流水', '所有期初余额、费用增加和报销支出统一展示，每笔流水都显示变动后余额。', `<button class="btn btn-outline btn-sm" data-action="export-ledger">导出当前筛选 CSV</button><button class="btn btn-outline btn-sm" data-action="export-all-ledger">导出全部流水</button>`)}
    ${carryCard}<div class="toolbar"><div class="field"><label>所属中心</label><select id="ledgerCenter"><option value="all" ${(!f.center||f.center==='all')?'selected':''}>全部中心</option>${CENTERS.map(c=>`<option value="${c.id}" ${f.center===c.id?'selected':''}>${c.name}</option>`).join('')}</select></div><div class="field"><label>流水类型</label><select id="ledgerType"><option value="all">全部类型</option><option value="opening">期初余额</option><option value="quarterly">季度费用发放</option><option value="refund">费用退回</option><option value="other">其他费用增加</option><option value="expense">报销支出</option></select></div><div class="field search"><label>关键词</label><input id="ledgerSearch" value="${escapeHtml(f.search||'')}" placeholder="事项、报销人、记录编号"></div><div class="field"><label>开始日期</label><input id="ledgerFrom" type="date" value="${escapeHtml(f.from||'')}"></div><div class="field"><label>结束日期</label><input id="ledgerTo" type="date" value="${escapeHtml(f.to||'')}"></div><button class="btn btn-outline btn-sm" data-action="filter-ledger">筛选</button><button class="btn btn-outline btn-sm" data-action="clear-ledger-filter">重置</button></div>
    <div class="table-card"><div class="table-wrap"><table class="data-table"><thead><tr><th>日期</th><th>所属中心</th><th>类型</th><th>事项</th><th class="right">资金变化</th><th class="right">变动后余额</th><th>记录编号</th><th>操作</th></tr></thead><tbody>${rows.length?rows.map(t=>`<tr><td>${formatDate(t.date)}</td><td>${centerPill(t.centerId)}</td><td>${escapeHtml(TYPE_LABELS[t.type]||t.type)}</td><td>${escapeHtml(t.desc)}</td><td class="right amount ${t.change>=0?'money-positive':'money-negative'}">${money(t.change,true)}</td><td class="right amount">${money(t.balanceAfter)}</td><td>${escapeHtml(t.id)}</td><td>${t.type==='opening'?'—':`<button class="record-link" data-action="view-record" data-center="${t.centerId}" data-id="${t.id}" data-kind="${t.type==='expense'?'expense':'addition'}">详情</button>`}</td></tr>`).join(''):`<tr><td colspan="8" class="table-empty">暂无资金流水</td></tr>`}</tbody></table></div><div class="table-foot"><span>共 ${rows.length} 笔有效流水 · 页面按日期由近到远排列</span><span>余额计算按日期正序执行</span></div></div>`;
}
function renderReports() {
  const [start, end] = dateRangeFromReport();
  const endBalances = CENTERS.map(c => ({ center: c, balance: balanceFor(getCenterData(c.id), end), data: getCenterData(c.id) }));
  const total = endBalances.some(x => x.balance === null) ? null : endBalances.reduce((s, x) => s + x.balance, 0);
  const dateMode = state.report.mode;
  $('#page-reports').innerHTML = `${pageHeading('统计报表', '只展示所选时间范围结束时的集团及各中心剩余费用。点击余额可下钻查看明细。', `<button class="btn btn-outline btn-sm" data-action="export-report">导出统计 CSV</button>`)}
    <div class="card" style="margin-bottom:18px"><div class="form-section"><div class="section-head"><div><h2>统计周期</h2><p>选择统计时间，余额按该周期最后一天计算。</p></div></div><div class="segmented" id="reportMode"><button data-mode="month" class="${dateMode==='month'?'active':''}">月度</button><button data-mode="quarter" class="${dateMode==='quarter'?'active':''}">季度</button><button data-mode="year" class="${dateMode==='year'?'active':''}">年度</button><button data-mode="custom" class="${dateMode==='custom'?'active':''}">自定义</button></div>${dateMode==='month'?`<div class="form-grid-two"><div class="field"><label>年份</label><select id="reportYear">${yearOptions(state.report.year)}</select></div><div class="field"><label>月份</label><select id="reportMonth">${Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0')).map(m=>`<option value="${m}" ${m===state.report.month?'selected':''}>${Number(m)}月</option>`).join('')}</select></div></div>`:dateMode==='quarter'?`<div class="form-grid-two"><div class="field"><label>年份</label><select id="reportYear">${yearOptions(state.report.year)}</select></div><div class="field"><label>季度</label><select id="reportQuarter">${[['Q1','第一季度'],['Q2','第二季度'],['Q3','第三季度'],['Q4','第四季度']].map(([v,l])=>`<option value="${v}" ${v===state.report.quarter?'selected':''}>${l}</option>`).join('')}</select></div></div>`:dateMode==='year'?`<div class="field"><label>年份</label><select id="reportYear">${yearOptions(state.report.year)}</select></div>`:`<div class="form-grid-two"><div class="field"><label>开始日期</label><input id="reportStart" type="date" value="${escapeHtml(state.report.start||start)}"></div><div class="field"><label>结束日期</label><input id="reportEnd" type="date" value="${escapeHtml(state.report.end||end)}"></div></div>`}<div class="inline-alert info">统计区间：${formatDate(start)} 至 ${formatDate(end)}。统计页面不展示费用增加、报销支出汇总或同比环比分析。</div></div></div>
    <button class="report-main report-main-button" data-action="drill-report" data-center="all" data-from="${start}" data-to="${end}"><span class="label">集团期末剩余费用 · ${periodLabel()}</span><span class="value">${total===null?'部分中心尚未初始化':money(total)}</span><span class="sub">截止 ${formatDate(end)} · 点击查看集团对应期间资金明细 →</span></button>
    <div class="section-head"><div><h2>三个中心余额</h2><p>三中心独立核算，余额持续跨季度累计。</p></div><span class="pill neutral">横向等宽展示</span></div>
    <div class="balance-stat-grid">${endBalances.map(x=>`<button class="balance-stat" style="background:${x.center.id==='gongjin'?'#eaf1ff':x.center.id==='innovation'?'#fff2e2':'#e1f6f2'};border-color:${x.center.color}33;text-align:left" data-action="drill-report" data-center="${x.center.id}" data-from="${start}" data-to="${end}"><span class="label" style="color:${x.center.color}">${x.center.name}</span><span class="value" style="color:${x.center.color}">${x.balance===null?'未启用':money(x.balance)}</span><small>查看该中心明细 →</small></button>`).join('')}</div>
    <div class="card" style="margin-top:18px"><div class="section-head"><div><h2>统计口径</h2><p>期末余额 = 期初余额 + 截止期末的有效费用增加 − 截止期末的有效报销支出。</p></div></div><div class="inline-alert info">点击集团期末余额可查看三个中心在所选期间的合并流水；点击单个中心余额可查看该中心的期间流水。页面不对三个中心进行排名或支出对比。</div><div class="form-actions"><button class="btn btn-outline btn-sm" data-action="drill-report" data-center="all" data-from="${start}" data-to="${end}">查看集团期间明细</button></div></div>`;
}
function yearOptions(selected) {
  const current = new Date().getFullYear();
  const years = new Set([current - 1, current, current + 1, Number(selected)]);
  return [...years].filter(Number.isFinite).sort((a,b)=>a-b).map(y=>`<option value="${y}" ${String(y)===String(selected)?'selected':''}>${y}年</option>`).join('');
}
function renderSettings() {
  const dataStatus = CENTERS.map(c => ({ center:c, initialized:!!getCenterData(c.id).openingBalance }));
  $('#page-settings').innerHTML = `${pageHeading('系统管理', '管理 GitHub 连接、演示账本、正式账本和数据备份。', `<button class="btn btn-outline btn-sm" data-action="reconnect">更换 GitHub 令牌</button>`)}
    <div class="settings-grid">
      <div class="settings-card"><h3>GitHub 仓库连接</h3><p>网站代码与费用数据分开存放。当前已连接到你的私有数据仓库。</p><div class="setting-row"><span>GitHub 账号</span><strong>${escapeHtml(state.githubUser)}</strong></div><div class="setting-row"><span>数据仓库</span><strong>${escapeHtml(state.owner)}/${escapeHtml(state.repo)}</strong></div><div class="setting-row"><span>分支</span><strong>${escapeHtml(state.branch)}</strong></div><div class="setting-row"><span>令牌保存方式</span><strong>仅当前网页内存</strong></div><button class="btn btn-outline btn-sm" data-action="reconnect">断开并更换令牌</button></div>
      <div class="settings-card"><h3>账本环境</h3><p>演示账本与正式账本使用不同目录。请勿将真实资料录入演示账本。</p><div class="setting-row"><span>当前环境</span><span class="environment-badge ${state.env}">${state.env==='demo'?'演示账本':'正式账本'}</span></div><div class="setting-row"><span>演示数据</span><strong>虚拟姓名和金额</strong></div><div class="setting-row"><span>正式数据</span><strong>公司批准后启用</strong></div><div class="form-actions"><button class="btn ${state.env==='demo'?'btn-primary':'btn-outline'} btn-sm" data-action="switch-env" data-env="demo" ${state.env==='demo'?'disabled':''}>切换演示账本</button><button class="btn ${state.env==='production'?'btn-primary':'btn-outline'} btn-sm" data-action="switch-env" data-env="production" ${state.env==='production'?'disabled':''}>切换正式账本</button></div></div>
      <div class="settings-card full"><h3>${state.env==='demo'?'演示账本初始化':'正式账本期初余额'}</h3><p>${state.env==='demo'?'首次连接时，建议先初始化一套虚拟数据以体验功能。初始化仅在三个演示数据文件均不存在时执行，不覆盖已有记录。':'正式账本只能在公司确认允许使用 GitHub 私有仓库存储真实业务资料后启用。初始化时录入上线当天三个中心的实际剩余余额。'}</p>${state.env==='demo'?`<button class="btn btn-primary btn-sm" data-action="init-demo">初始化虚拟演示数据</button>`:`<div class="notice notice-warn"><strong>正式数据注意事项</strong><span>GitHub 私有仓库仍属于外部云存储。未经公司批准，请勿上传真实姓名、付款截图、发票或客户资料。</span></div><form id="productionInitForm" class="form-grid-single"><div class="field"><label for="prodDate">账套启用日期</label><input id="prodDate" type="date" value="${today()}" required></div><div class="form-grid-two">${CENTERS.map(c=>`<div class="field"><label for="balance-${c.id}">${c.name}期初剩余费用（元）</label><input id="balance-${c.id}" type="number" min="0" step="0.01" placeholder="请输入实际剩余费用" required></div>`).join('')}</div><label class="check-line"><input id="companyApproval" type="checkbox"><span>我已确认公司批准将真实账目及附件以明文存储在 GitHub 私有仓库，并完成公开 Pages 页面令牌处理安全审查。</span></label><button class="btn btn-primary btn-sm" type="submit">初始化正式账本</button></form>`}</div>
      <div class="settings-card"><h3>数据备份</h3><p>导出当前账本的 JSON 数据备份。附件文件仍保存在 GitHub 仓库中，需要通过仓库备份另行保存。</p><button class="btn btn-outline btn-sm" data-action="backup-json">下载账本 JSON 备份</button><div class="setting-row"><span>当前中心</span><strong>${dataStatus.filter(x=>x.initialized).length}/3 已初始化</strong></div></div>
      <div class="settings-card"><h3>使用说明与安全</h3><p>只存储代码于公开网站仓库；真实或演示数据写入私有数据仓库。令牌不写入代码和本地存储。</p><div class="setting-row"><span>当前环境</span><strong>${state.env==='demo'?'演示':'正式'}</strong></div><div class="setting-row"><span>单个附件限制</span><strong>10MB</strong></div><div class="setting-row"><span>系统模式</span><strong>单人管理 / 无数据库</strong></div><a href="docs/使用说明.md" target="_blank" rel="noopener noreferrer">打开完整使用说明 ↗</a></div>
    </div>`;
}
function renderRecordForm(type) {
  if (type === 'expense') renderExpenseForm(); else renderAdditionForm();
  showPage(type === 'expense' ? 'expenses' : 'additions');
  if (type === 'addition') { updateAdditionTypeFields(); refreshRefundOptions('gongjin'); }
}
function updateAdditionTypeFields() {
  const type = $('#additionTypeInput')?.value || 'quarterly';
  $('#quarterFields').hidden = type !== 'quarterly';
  $('#refundFields').hidden = type !== 'refund';
  $('#reasonFields').hidden = type !== 'quarterly' && type !== 'refund';
  const reasonLabel = $('#reasonFields label');
  if (reasonLabel) reasonLabel.textContent = '增加事项及原因 *';
}

function refreshRefundOptions(centerId) {
  const select = $('#linkedExpense');
  if (!select) return;
  const previous = select.value;
  const options = (getCenterData(centerId).expenses || []).filter(e => e.status !== 'voided').map(e => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.matter)} · ${escapeHtml(e.person)} · ${money(e.amountCents)}</option>`).join('');
  select.innerHTML = `<option value="">不关联原支出</option>${options}`;
  if ([...select.options].some(o => o.value === previous)) select.value = previous;
}
function updateFormBalance(type) {
  const centerId = $(`#${type}CenterId`)?.value || 'gongjin';
  const el = $(`#${type}BalancePreview`);
  if (el) el.textContent = balanceFor(getCenterData(centerId)) === null ? '未初始化' : money(balanceFor(getCenterData(centerId)));
}
async function handleExpenseSubmit(event) {
  event.preventDefault();
  if (!state.connected || !state.token) return toast('请先连接 GitHub 私有仓库。', 'error');
  const centerId = $('#expenseCenterId').value;
  const date = $('#expenseDate').value;
  const matter = $('#expenseMatter').value.trim();
  const person = $('#expensePerson').value.trim();
  const amountCents = toCents($('#expenseAmount').value);
  const remark = $('#expenseRemark').value.trim();
  if (!date || !matter || !person || !Number.isFinite(amountCents) || amountCents <= 0) return toast('请完整填写打款日期、用款事项、报销人和有效金额。', 'error');
  if (!getCenterData(centerId).openingBalance) return toast('该中心尚未初始化期初余额，请先在系统管理中设置。', 'error');
  if (date < getCenterData(centerId).openingBalance.effectiveDate) return toast('打款日期不能早于系统启用日期。', 'error');
  const maybeDuplicate = (getCenterData(centerId).expenses || []).some(e => e.status !== 'voided' && e.date === date && e.person === person && e.amountCents === amountCents);
  if (maybeDuplicate && !window.confirm('发现同一中心、同一日期、同一报销人、相同金额的记录，可能重复。仍然继续保存吗？')) return;
  const button = $('#saveExpenseButton'); setBusy(button, true, '正在上传附件并保存…');
  const id = makeId('BX');
  let refs = { payment: [], invoices: [] };
  try {
    const uploaded = await uploadPendingFiles(centerId, id, ['payment', 'invoices']);
    refs = { payment: uploaded.payment, invoices: uploaded.invoices };
    const data = await getJsonFile(centerPath(centerId)) || emptyCenterData(centerById(centerId));
    if ((data.expenses || []).some(e => e.id === id)) throw new Error('记录编号重复，请重新提交。');
    data.expenses = data.expenses || [];
    data.expenses.push({ id, date, matter, person, amountCents, remark, status: 'active', attachments: refs, createdAt: dateTime() });
    await saveCenterData(centerId, data, `新增报销 ${id} · ${centerById(centerId).name}`);
    state.pendingFiles = { payment: [], invoices: [] };
    toast(`报销记录已保存：${id}`);
    renderAll(); showPage('expenses');
  } catch (err) {
    for (const ref of [...refs.payment, ...refs.invoices]) { try { await deleteRepoFile(ref.path, '清理未关联的报销附件'); } catch (_) {} }
    toast(err.message || '保存失败，请检查网络和仓库权限。', 'error', 5500);
  }
  finally { setBusy(button, false); }
}
async function handleAdditionSubmit(event) {
  event.preventDefault();
  if (!state.connected || !state.token) return toast('请先连接 GitHub 私有仓库。', 'error');
  const type = $('#additionTypeInput').value;
  const centerId = $('#additionCenterId').value;
  const date = $('#additionDate').value;
  const amountCents = toCents($('#additionAmount').value);
  const remark = $('#additionRemark').value.trim();
  if (!date || !Number.isFinite(amountCents) || amountCents <= 0) return toast('请填写实际增加日期和大于0的金额。', 'error');
  if (!getCenterData(centerId).openingBalance) return toast('该中心尚未初始化期初余额，请先在系统管理中设置。', 'error');
  if (date < getCenterData(centerId).openingBalance.effectiveDate) return toast('费用增加日期不能早于系统启用日期。', 'error');
  const record = { id: makeId('FY'), date, type, amountCents, remark, status: 'active', attachments: { files: [] }, createdAt: dateTime() };
  if (type === 'quarterly') {
    record.quarterYear = $('#quarterYear').value.trim();
    record.quarter = $('#quarterValue').value;
    if (!record.quarterYear || Number(record.quarterYear) < 2000 || Number(record.quarterYear) > 2100) return toast('请填写有效的所属年份。', 'error');
    const duplicate = (getCenterData(centerId).additions || []).some(a => a.status !== 'voided' && a.type === 'quarterly' && a.quarterYear === record.quarterYear && a.quarter === record.quarter);
    if (duplicate && !window.confirm(`该中心已有${record.quarterYear}年${quarterLabel(record.quarter)}费用发放记录，仍然继续新增吗？`)) return;
  } else if (type === 'refund') {
    record.linkedExpenseId = $('#linkedExpense').value || '';
    record.reason = '费用退回';
    if (record.linkedExpenseId) {
      const linked = (getCenterData(centerId).expenses || []).find(e => e.id === record.linkedExpenseId);
      if (linked && amountCents > linked.amountCents && !window.confirm('本次退回金额大于关联原支出金额，是否确认继续？')) return;
    }
  } else {
    record.reason = $('#additionReason').value.trim();
    if (!record.reason) return toast('其他费用增加必须填写增加事项及原因。', 'error');
  }
  const button = $('#saveAdditionButton'); setBusy(button, true, '正在上传附件并保存…');
  let uploadedRefs = { payment: [], invoices: [] };
  try {
    const uploaded = await uploadPendingFiles(centerId, record.id, ['payment', 'invoices']);
    uploadedRefs = uploaded;
    record.attachments = { files: [...uploaded.payment, ...uploaded.invoices] };
    record.attachmentGroups = { payment: uploaded.payment, invoices: uploaded.invoices };
    const data = await getJsonFile(centerPath(centerId)) || emptyCenterData(centerById(centerId));
    data.additions = data.additions || [];
    data.additions.push(record);
    await saveCenterData(centerId, data, `新增费用增加 ${record.id} · ${centerById(centerId).name}`);
    state.pendingFiles = { payment: [], invoices: [] };
    toast(`费用增加记录已保存：${record.id}`);
    renderAll(); showPage('additions');
  } catch (err) {
    for (const ref of [...uploadedRefs.payment, ...uploadedRefs.invoices]) { try { await deleteRepoFile(ref.path, '清理未关联的费用增加附件'); } catch (_) {} }
    toast(err.message || '保存失败，请检查网络和仓库权限。', 'error', 5500);
  }
  finally { setBusy(button, false); }
}
function renderDetailModal(centerId, recordId, kind) {
  const data = getCenterData(centerId);
  const record = kind === 'expense' ? (data.expenses || []).find(x=>x.id===recordId) : (data.additions || []).find(x=>x.id===recordId);
  if (!record) return toast('找不到这条记录。', 'error');
  const isExpense = kind === 'expense';
  const files = isExpense ? [...(record.attachments?.payment || []).map(x=>({...x,group:'付款凭证'})), ...(record.attachments?.invoices || []).map(x=>({...x,group:'发票附件'}))] : (record.attachmentGroups ? [...(record.attachmentGroups.payment || []), ...(record.attachmentGroups.invoices || [])] : (record.attachments?.files || [])).map(x=>({...x,group:x.mime==='application/pdf'?'发票/相关附件':'相关附件'}));
  const html = `<div class="modal-backdrop" data-action="close-modal"><div class="modal" role="dialog" aria-modal="true" aria-label="记录详情"><div class="modal-header"><div><div class="eyebrow-dark">RECORD DETAIL</div><h2>${isExpense?'报销记录详情':'费用增加详情'}</h2></div><button class="modal-close" data-action="close-modal">×</button></div><div class="detail-grid"><div class="detail-item"><small>记录编号</small><strong>${escapeHtml(record.id)}</strong></div><div class="detail-item"><small>所属中心</small><strong>${centerById(centerId).name}</strong></div><div class="detail-item"><small>${isExpense?'打款日期':'实际增加日期'}</small><strong>${formatDate(record.date)}</strong></div><div class="detail-item"><small>${isExpense?'报销人':'增加类型'}</small><strong>${isExpense?escapeHtml(record.person):escapeHtml(TYPE_LABELS[record.type]||record.type)}</strong></div><div class="detail-item"><small>${isExpense?'用款事项':'增加事项'}</small><strong>${escapeHtml(isExpense?record.matter:additionDescription(record))}</strong></div><div class="detail-item"><small>金额</small><strong class="${isExpense?'money-negative':'money-positive'}">${money(record.amountCents)}</strong></div>${!isExpense&&record.type==='quarterly'?`<div class="detail-item"><small>费用所属季度</small><strong>${record.quarterYear}年${quarterLabel(record.quarter)}</strong></div>`:''}${!isExpense&&record.linkedExpenseId?`<div class="detail-item"><small>关联原支出</small><strong>${escapeHtml(record.linkedExpenseId)}</strong></div>`:''}<div class="detail-item"><small>状态</small><strong>${record.status==='voided'?'已作废':'有效'}</strong></div></div><hr class="section-divider"><div class="form-section"><h3>附件</h3>${files.length?`<div class="attachment-grid">${files.map((f,i)=>`<div class="attachment-card"><div class="attachment-icon">${f.mime==='application/pdf'?'PDF':'IMG'}</div><span><strong>${escapeHtml(f.name)}</strong><small>${f.group} · ${formatBytes(f.size||0)}</small></span><button data-action="preview-attachment" data-path="${escapeHtml(f.path)}" data-name="${escapeHtml(f.name)}" data-mime="${escapeHtml(f.mime)}">查看</button></div>`).join('')}</div>`:'<div class="empty-state">该记录没有上传附件</div>'}</div>${record.remark?`<div class="form-section"><h3>备注</h3><p class="muted">${escapeHtml(record.remark)}</p></div>`:''}${record.status==='voided'?`<div class="confirm-box">作废原因：${escapeHtml(record.voidReason||'未填写')}</div>`:''}<div class="modal-actions">${record.status!=='voided'?`<button class="btn btn-danger btn-sm" data-action="void-record" data-center="${centerId}" data-id="${recordId}" data-kind="${kind}">作废记录</button>`:''}<button class="btn btn-outline btn-sm" data-action="close-modal">关闭</button></div></div></div>`;
  $('#modalRoot').innerHTML = html;
}
function showVoidModal(centerId, recordId, kind) {
  $('#modalRoot').innerHTML = `<div class="modal-backdrop" data-action="close-modal"><div class="modal" role="dialog" aria-modal="true"><div class="modal-header"><h2>作废资金记录</h2><button class="modal-close" data-action="close-modal">×</button></div><div class="confirm-box">作废后，这笔记录不再参与余额计算，但原始记录仍保留在仓库版本历史中。请确认确实需要作废。</div><form id="voidForm" class="form-stack"><input type="hidden" id="voidCenter" value="${centerId}"><input type="hidden" id="voidRecord" value="${recordId}"><input type="hidden" id="voidKind" value="${kind}"><div class="field"><label for="voidReason">作废原因 *</label><textarea id="voidReason" class="textarea" rows="3" required maxlength="300" placeholder="例如：金额录入错误、所属中心选错、重复记录"></textarea></div><div class="modal-actions"><button class="btn btn-outline btn-sm" type="button" data-action="close-modal">取消</button><button class="btn btn-danger btn-sm" type="submit" id="confirmVoidButton">确认作废</button></div></form></div></div>`;
}
async function handleVoidSubmit(event) {
  event.preventDefault();
  const centerId = $('#voidCenter').value, id = $('#voidRecord').value, kind = $('#voidKind').value, reason = $('#voidReason').value.trim();
  if (!reason) return toast('请填写作废原因。', 'error');
  const button = $('#confirmVoidButton'); setBusy(button, true, '正在处理…');
  try {
    const data = await getJsonFile(centerPath(centerId));
    if (!data) throw new Error('找不到所属中心账本。');
    const listKey = kind === 'expense' ? 'expenses' : 'additions';
    const item = (data[listKey] || []).find(x=>x.id===id);
    if (!item) throw new Error('找不到原始记录。');
    if (item.status === 'voided') throw new Error('这条记录已经作废。');
    item.status = 'voided'; item.voidReason = reason; item.voidedAt = dateTime();
    await saveCenterData(centerId, data, `作废资金记录 ${id}`);
    $('#modalRoot').innerHTML = '';
    toast('记录已作废，余额已重新计算。');
    renderAll();
  } catch (err) { toast(err.message, 'error'); }
  finally { setBusy(button, false); }
}
async function previewAttachment(path, name, mime) {
  if (!path) return;
  toast('正在读取私有附件…', 'success', 1800);
  try {
    const blob = await getBinaryFile(path);
    const objectUrl = URL.createObjectURL(new Blob([blob], { type: mime || blob.type || 'application/octet-stream' }));
    const body = (mime || blob.type).includes('pdf') ? `<iframe class="pdf-preview" src="${objectUrl}" title="${escapeHtml(name)}"></iframe>` : (mime || blob.type).startsWith('image/') ? `<img class="image-preview" src="${objectUrl}" alt="${escapeHtml(name)}">` : `<p>该文件类型暂不支持在线预览。</p>`;
    $('#modalRoot').innerHTML = `<div class="modal-backdrop" data-action="close-modal"><div class="modal preview-modal" role="dialog" aria-modal="true"><div class="modal-header"><h2>${escapeHtml(name)}</h2><button class="modal-close" data-action="close-modal">×</button></div>${body}<div class="modal-actions"><a class="btn btn-primary btn-sm" href="${objectUrl}" download="${escapeHtml(name)}">下载附件</a><button class="btn btn-outline btn-sm" data-action="close-modal">关闭</button></div></div></div>`;
  } catch (err) { toast(`附件读取失败：${err.message}`, 'error', 5000); }
}
function downloadText(filename, text, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 3000);
}
function csvEscape(value) { return `"${String(value ?? '').replace(/"/g, '""')}"`; }
function exportCsv(filename, headers, rows) {
  const content = '\uFEFF' + [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\r\n');
  downloadText(filename, content, 'text/csv;charset=utf-8');
  toast('CSV 文件已导出，可使用 Excel 打开。');
}
function exportExpenses(filtered = true) {
  let rows = allCenterData().flatMap(({center,data})=>(data.expenses||[]).map(r=>({...r,centerId:center.id})));
  if (filtered) {
    const f=state.filters.expenses||{};
    rows=rows.filter(r=>(!f.center||f.center==='all'||r.centerId===f.center)&&(!f.from||r.date>=f.from)&&(!f.to||r.date<=f.to)&&`${r.id} ${r.matter} ${r.person}`.toLowerCase().includes((f.search||'').toLowerCase()));
  }
  rows.sort((a,b)=>b.date.localeCompare(a.date));
  exportCsv(`支出记录_${filtered?'当前筛选':'全部'}_${today()}.csv`,['记录编号','打款日期','所属中心','用款事项','报销人','报销金额(元)','状态','付款凭证数量','发票数量','备注'],rows.map(r=>[r.id,r.date,centerById(r.centerId).name,r.matter,r.person,(r.amountCents/100).toFixed(2),r.status==='voided'?'已作废':'有效',r.attachments?.payment?.length||0,r.attachments?.invoices?.length||0,r.remark||'']));
}
function exportAdditions(filtered = true) {
  const f=state.filters.additions||{};
  let rows=allCenterData().flatMap(({center,data})=>(data.additions||[]).map(r=>({...r,centerId:center.id})));
  if(filtered) rows=rows.filter(r=>(!f.center||f.center==='all'||r.centerId===f.center)&&(!f.type||f.type==='all'||r.type===f.type)&&`${r.id} ${additionDescription(r)} ${r.reason||''}`.toLowerCase().includes((f.search||'').toLowerCase()));
  rows.sort((a,b)=>b.date.localeCompare(a.date));
  exportCsv(`费用增加_${filtered?'当前筛选':'全部'}_${today()}.csv`,['记录编号','实际增加日期','所属中心','增加类型','事项','所属季度','增加金额(元)','关联原支出','状态','备注'],rows.map(r=>[r.id,r.date,centerById(r.centerId).name,TYPE_LABELS[r.type],additionDescription(r),r.type==='quarterly'?`${r.quarterYear}年${quarterLabel(r.quarter)}`:'',(r.amountCents/100).toFixed(2),r.linkedExpenseId||'',r.status==='voided'?'已作废':'有效',r.remark||'']));
}
function exportLedger(filtered = true) {
  const f=state.filters.ledger||{};
  let rows=allTransactions().filter(t=>t.status!=='voided');
  if(filtered) rows=rows.filter(t=>(!f.center||f.center==='all'||t.centerId===f.center)&&(!f.type||f.type==='all'||t.type===f.type)&&(!f.from||t.date>=f.from)&&(!f.to||t.date<=f.to)&&`${t.id} ${t.desc} ${t.person}`.toLowerCase().includes((f.search||'').toLowerCase()));
  exportCsv(`资金流水_${filtered?'当前筛选':'全部'}_${today()}.csv`,['流水编号','日期','所属中心','类型','事项','资金变化(元)','变动后余额(元)','状态'],rows.map(r=>[r.id,r.date,centerById(r.centerId).name,TYPE_LABELS[r.type],r.desc,(r.change/100).toFixed(2),(r.balanceAfter/100).toFixed(2),'有效']));
}
function exportReport() {
  const [start,end]=dateRangeFromReport();
  exportCsv(`余额统计_${periodLabel()}_${today()}.csv`,['统计期间','统计截止日期','费用中心','期末剩余费用(元)'],CENTERS.map(c=>[periodLabel(),end,c.name,balanceFor(getCenterData(c.id),end)===null?'未初始化':(balanceFor(getCenterData(c.id),end)/100).toFixed(2)]));
}
function exportBackup() {
  const backup={product:'深度数科中心费用台账系统',schemaVersion:1,environment:state.env,exportedAt:dateTime(),repository:{owner:state.owner,name:state.repo,branch:state.branch},centers:state.data,note:'此 JSON 包含台账数据和附件路径，不包含附件二进制文件。附件仍保存在 GitHub 私有仓库。'};
  downloadText(`深度数科费用台账备份_${state.env}_${today()}.json`,JSON.stringify(backup,null,2),'application/json;charset=utf-8');
}
function setReportMode(mode) { state.report.mode=mode; renderReports(); }
function drillReport(centerId, from, to) {
  state.filters.ledger={center:centerId,from,to,type:'all',search:''};
  renderLedger(); showPage('ledger');
  toast('已打开所选统计期间的资金明细。');
}
function switchEnvironment(env) {
  if (env===state.env) return;
  if (env==='production') {
    const yes=window.confirm('即将切换到正式账本。正式账本与演示账本目录分开。请确保公司已批准使用 GitHub 私有仓库存储真实业务资料。继续吗？');
    if(!yes)return;
  }
  state.env=env; savePublicConfig();
  loadAllData().then(()=>{renderAll();toast(`已切换到${env==='demo'?'演示':'正式'}账本。`);}).catch(e=>toast(e.message,'error'));
}
function reconnect() {
  state.token=null;state.connected=false;state.githubUser='';state.data={};
  $('#appShell').hidden=true;$('#connectionScreen').hidden=false;
  $('#githubToken').value='';$('#connectError').hidden=true;
  toast('已断开 GitHub 连接。重新输入令牌即可继续使用。');
}
async function handleConnection(event) {
  event.preventDefault();
  const owner=$('#repoOwner').value.trim();const repo=$('#repoName').value.trim();const branch=$('#repoBranch').value.trim()||'main';const token=$('#githubToken').value.trim();
  if(!owner||!repo||!token)return;
  const button=$('#connectButton');const err=$('#connectError');err.hidden=true;setBusy(button,true,'正在验证 GitHub 连接…');
  try{
    const info=await testGithubConnection(token,owner,repo);
    state.token=token;state.owner=owner;state.repo=repo;state.branch=branch;state.githubUser=info.user;state.connected=true;
    savePublicConfig();$('#githubToken').value='';
    await loadAllData();
    $('#connectionScreen').hidden=true;$('#appShell').hidden=false;
    renderAll();
    toast(`已连接 ${owner}/${repo}，数据已读取。`);
  }catch(e){state.token=null;state.connected=false;err.textContent=e.message||'连接失败';err.hidden=false;}
  finally{setBusy(button,false);}
}
async function reloadData() {
  try{await loadAllData();renderAll();toast('已从 GitHub 重新读取最新数据。');}
  catch(e){toast(e.message,'error',5000);}
}
function setFormCenter(type, centerId) {
  const hidden=$(`#${type}CenterId`);if(hidden)hidden.value=centerId;
  const root=hidden?.parentElement; if(root)$$('[data-action="select-center"]',root).forEach(b=>b.classList.toggle('selected',b.dataset.center===centerId));
  updateFormBalance(type);
  if (type === 'addition') refreshRefundOptions(centerId);
}
function openPageFromAction(page) { showPage(page); }

document.addEventListener('submit', async event => {
  if(event.target.id==='connectForm') return handleConnection(event);
  if(event.target.id==='expenseForm') return handleExpenseSubmit(event);
  if(event.target.id==='additionForm') return handleAdditionSubmit(event);
  if(event.target.id==='voidForm') return handleVoidSubmit(event);
  if(event.target.id==='productionInitForm') {
    event.preventDefault();
    if(!$('#companyApproval').checked) return toast('请先确认公司已批准使用 GitHub 私有仓库存储真实业务资料。','error');
    const values={date:$('#prodDate').value};
    for(const c of CENTERS)values[c.id]=$(`#balance-${c.id}`).value;
    const btn=event.submitter;setBusy(btn,true,'正在初始化…');
    try{await initializeProduction(values);}
    catch(e){toast(e.message,'error',5000);}
    finally{setBusy(btn,false);}
  }
});
document.addEventListener('change', event => {
  if(event.target.id==='paymentFiles')setPendingFiles('payment',[...event.target.files]);
  if(event.target.id==='invoiceFiles')setPendingFiles('invoices',[...event.target.files]);
  if(event.target.id==='additionTypeInput')updateAdditionTypeFields();
  if(event.target.id==='expenseDate'||event.target.id==='additionDate') { /* business date is read on submit */ }
  if(event.target.id==='reportYear'){state.report.year=event.target.value;renderReports();}
  if(event.target.id==='reportMonth'){state.report.month=event.target.value;renderReports();}
  if(event.target.id==='reportQuarter'){state.report.quarter=event.target.value;renderReports();}
  if(event.target.id==='reportStart'){state.report.start=event.target.value;renderReports();}
  if(event.target.id==='reportEnd'){state.report.end=event.target.value;renderReports();}
});
document.addEventListener('click', async event => {
  const target=event.target.closest('[data-action]');
  if(!target)return;
  const action=target.dataset.action;
  if(action==='close-modal'){if(event.target===target||target.classList.contains('modal-close'))$('#modalRoot').innerHTML='';return;}
  if(action==='select-center'){const type=$('#expenseCenterId')?'expense':'addition';setFormCenter(type,target.dataset.center);return;}
  if(action==='remove-pending'){const group=target.dataset.group;const index=Number(target.dataset.index);state.pendingFiles[group].splice(index,1);renderFileList(group);return;}
  if(action==='go-expense'){renderRecordForm('expense');return;}
  if(action==='go-addition'){renderRecordForm('addition');return;}
  if(action==='show-expense-list'){renderExpenses();showPage('expenses');return;}
  if(action==='show-addition-list'){renderAdditions();showPage('additions');return;}
  if(action==='go-settings'){showPage('settings');return;}
  if(action==='filter-expenses'){state.filters.expenses={center:$('#expenseCenter').value,search:$('#expenseSearch').value.trim(),from:$('#expenseFrom').value,to:$('#expenseTo').value};renderExpenses();return;}
  if(action==='clear-expense-filter'){state.filters.expenses={};renderExpenses();return;}
  if(action==='filter-additions'){state.filters.additions={center:$('#additionCenter').value,type:$('#additionType').value,search:$('#additionSearch').value.trim()};renderAdditions();return;}
  if(action==='clear-addition-filter'){state.filters.additions={};renderAdditions();return;}
  if(action==='filter-ledger'){state.filters.ledger={center:$('#ledgerCenter').value,type:$('#ledgerType').value,search:$('#ledgerSearch').value.trim(),from:$('#ledgerFrom').value,to:$('#ledgerTo').value};renderLedger();return;}
  if(action==='clear-ledger-filter'){state.filters.ledger={};renderLedger();return;}
  if(action==='view-record'){renderDetailModal(target.dataset.center,target.dataset.id,target.dataset.kind);return;}
  if(action==='void-record'){showVoidModal(target.dataset.center,target.dataset.id,target.dataset.kind);return;}
  if(action==='preview-attachment'){await previewAttachment(target.dataset.path,target.dataset.name,target.dataset.mime);return;}
  if(action==='reload-data'){await reloadData();return;}
  if(action==='reconnect'){reconnect();return;}
  if(action==='init-demo'){
    const yes=window.confirm('将向 GitHub 私有仓库写入三中心虚拟演示数据。不会写入真实费用或公司资料。是否继续？');
    if(!yes)return;
    target.disabled=true;try{await initializeDemoData();}catch(e){toast(e.message,'error',5500);}finally{target.disabled=false;}return;
  }
  if(action==='switch-env'){switchEnvironment(target.dataset.env);return;}
  if(action==='backup-json'){exportBackup();return;}
  if(action==='export-expenses'){exportExpenses(true);return;}
  if(action==='export-all-expenses'){exportExpenses(false);return;}
  if(action==='export-additions'){exportAdditions(true);return;}
  if(action==='export-all-additions'){exportAdditions(false);return;}
  if(action==='export-ledger'){exportLedger(true);return;}
  if(action==='export-all-ledger'){exportLedger(false);return;}
  if(action==='export-report'){exportReport();return;}
  if(action==='drill-report'){drillReport(target.dataset.center,target.dataset.from,target.dataset.to);return;}
});
document.addEventListener('click', event => {
  const nav=event.target.closest('.nav-item');
  if(nav){
    const page=nav.dataset.page;
    if(page==='dashboard')renderDashboard();
    else if(page==='expenses')renderExpenses();
    else if(page==='additions')renderAdditions();
    else if(page==='ledger')renderLedger();
    else if(page==='reports')renderReports();
    else if(page==='settings')renderSettings();
    showPage(page);return;
  }
  const mode=event.target.closest('[data-mode]');
  if(mode){state.report.mode=mode.dataset.mode;if(!state.report.start)state.report.start=`${state.report.year}-01-01`;if(!state.report.end)state.report.end=today();renderReports();return;}
});
$('#mobileMenu').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));
$('#refreshButton').addEventListener('click',reloadData);
$('#topConnectionButton').addEventListener('click',reconnect);
restorePublicConfig();
