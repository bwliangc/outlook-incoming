(() => {
  const STORAGE_KEY = 'outlook-incoming.quick-mail.v2';
  const DEFAULT_HELPER_URL = '/api';
  const MAILBOXES = ['INBOX', 'Junk'];
  const REQUEST_TIMEOUT_MS = 60000;

  const $ = (selector) => document.querySelector(selector);

  const elements = {
    themeToggleBtn: $('#themeToggleBtn'),
    clearDataBtn: $('#clearDataBtn'),
    currentCode: $('#currentCode'),
    currentMeta: $('#currentMeta'),
    copyCodeBtn: $('#copyCodeBtn'),
    mailDetail: $('#mailDetail'),
    importText: $('#importText'),
    importBtn: $('#importBtn'),
    sampleBtn: $('#sampleBtn'),
    accountCount: $('#accountCount'),
    accountsList: $('#accountsList'),
    toastHost: $('#toastHost'),
  };

  const state = {
    accounts: [],
    currentCode: '',
    currentAccountEmail: '',
    currentSubject: '',
    currentMailContent: '',
    currentMailHtml: '',
    currentSender: '',
    currentReceivedAt: '',
    selectedAccountEmail: '',
    theme: 'light',
    busy: false,
  };

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function accountId(account) {
    return normalizeEmail(account.email);
  }

  function applyTheme() {
    document.documentElement.dataset.theme = state.theme;
    elements.themeToggleBtn.textContent = state.theme === 'dark' ? '白天' : '夜间';
  }

  function toggleTheme() {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    applyTheme();
    saveState();
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      state.accounts = Array.isArray(saved.accounts) ? saved.accounts : [];
      state.currentCode = String(saved.currentCode || '');
      state.currentAccountEmail = String(saved.currentAccountEmail || '');
      state.currentSubject = String(saved.currentSubject || '');
      state.currentMailContent = String(saved.currentMailContent || '');
      state.currentMailHtml = String(saved.currentMailHtml || '');
      state.currentSender = String(saved.currentSender || '');
      state.currentReceivedAt = String(saved.currentReceivedAt || '');
      state.selectedAccountEmail = String(saved.selectedAccountEmail || saved.currentAccountEmail || '');
      state.theme = saved.theme === 'dark' ? 'dark' : 'light';
      const currentAccount = state.accounts.find((account) => accountId(account) === normalizeEmail(state.currentAccountEmail));
      if (currentAccount && !currentAccount.lastMail && (state.currentMailContent || state.currentMailHtml)) {
        currentAccount.lastMail = {
          code: state.currentCode,
          subject: state.currentSubject,
          content: state.currentMailContent,
          html: state.currentMailHtml,
          sender: state.currentSender,
          receivedAt: state.currentReceivedAt,
        };
        currentAccount.lastCode = currentAccount.lastCode || state.currentCode;
        currentAccount.lastFetchAt = currentAccount.lastFetchAt || state.currentReceivedAt;
      }
    } catch (_) {
      state.accounts = [];
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      accounts: state.accounts,
      currentCode: state.currentCode,
      currentAccountEmail: state.currentAccountEmail,
      currentSubject: state.currentSubject,
      currentMailContent: state.currentMailContent,
      currentMailHtml: state.currentMailHtml,
      currentSender: state.currentSender,
      currentReceivedAt: state.currentReceivedAt,
      selectedAccountEmail: state.selectedAccountEmail,
      theme: state.theme,
    }));
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatTime(value) {
    if (!value) return '—';
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) return '—';
    const date = new Date(timestamp);
    const pad = (number) => String(number).padStart(2, '0');
    return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日-${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function showToast(message, type = '') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`.trim();
    toast.textContent = message;
    elements.toastHost.appendChild(toast);
    setTimeout(() => toast.remove(), 3200);
  }

  function shortError(error) {
    return String(error?.message || error || '请求失败').replace(/\s+/g, ' ').slice(0, 220);
  }

  function decodeHtmlEntities(value) {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = String(value || '');
    return textarea.value;
  }

  function looksLikeHtml(value) {
    const raw = String(value || '');
    return /<\s*(?:!doctype|html|body|table|div|span|p|br|img|a|style|meta|head)\b/i.test(raw)
      || /&lt;\s*(?:!doctype|html|body|table|div|span|p|br|img|a|style|meta|head)\b/i.test(raw);
  }

  function normalizeRenderableHtml(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/<\s*(?:!doctype|html|body|table|div|span|p|br|img|a|style|meta|head)\b/i.test(raw)) return raw;
    const decoded = decodeHtmlEntities(raw).trim();
    return looksLikeHtml(decoded) ? decoded : '';
  }

  function cleanExtractedText(value) {
    return String(value || '')
      .replace(/@font-face\s*\{[\s\S]*?\}/gi, ' ')
      .replace(/@media[^{]*\{[\s\S]*?\}\s*\}/gi, ' ')
      .replace(/(?:\.[\w-]+|#[\w-]+|[a-z][\w-]*)\s*(?:,\s*(?:\.[\w-]+|#[\w-]+|[a-z][\w-]*)\s*)*\{[\s\S]*?\}/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function setBusy(flag) {
    state.busy = flag;
    elements.importBtn.disabled = flag;
    renderAccounts();
  }

  async function postHelper(path, payload) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${DEFAULT_HELPER_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload || {}),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      return data;
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error('请求超时，请确认 helper 是否仍在工作');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function normalizeImportedAccount(account) {
    const email = String(account.email || '').trim();
    return {
      id: normalizeEmail(email),
      email,
      clientId: String(account.clientId || '').trim(),
      refreshToken: String(account.refreshToken || '').trim(),
      status: 'authorized',
      used: false,
    };
  }

  function upsertAccount(nextAccount) {
    const id = accountId(nextAccount);
    if (!id) return;
    const existing = state.accounts.find((item) => accountId(item) === id);
    state.accounts = window.HotmailUtils.upsertHotmailAccountInList(state.accounts, {
      ...(existing || {}),
      ...nextAccount,
      id,
      email: nextAccount.email || existing?.email || id,
    });
  }

  function importAccounts() {
    const imported = window.HotmailUtils.parseHotmailImportText(elements.importText.value)
      .map(normalizeImportedAccount)
      .filter((account) => account.email && account.clientId && account.refreshToken);

    if (!imported.length) {
      showToast('没有解析到有效账号', 'error');
      return;
    }

    imported.forEach(upsertAccount);
    if (!state.selectedAccountEmail && imported[0]?.email) {
      state.selectedAccountEmail = imported[0].email;
      syncCurrentFromSelectedAccount();
    }
    saveState();
    render();
    showToast(`已导入 ${imported.length} 个账号`, 'success');
  }

  function sortedAccounts() {
    return state.accounts.slice();
  }

  function statusInfo(account) {
    if (account.lastStatus === 'running') return ['running', '取件中'];
    if (account.used) return ['used', '已用'];
    if (account.lastStatus === 'failed') return ['failed', '失败'];
    if (account.lastStatus === 'success') return [account.lastCode ? 'success' : 'idle', account.lastCode ? '有码' : '有邮件'];
    return ['idle', '待取'];
  }

  function buildMailPayload(account) {
    return {
      email: account.email,
      clientId: account.clientId,
      refreshToken: account.refreshToken,
      top: 1,
      mailboxes: MAILBOXES,
    };
  }

  async function copyText(text, successMessage = '已复制') {
    const value = String(text || '').trim();
    if (!value) {
      showToast('没有可复制内容', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
    } catch (_) {
      const input = document.createElement('textarea');
      input.value = value;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    showToast(successMessage, 'success');
  }

  async function fetchMailForAccount(email) {
    const account = state.accounts.find((item) => accountId(item) === normalizeEmail(email));
    if (!account) return;

    account.lastStatus = 'running';
    account.lastError = '';
    account.lastCode = '';
    account.lastFetchAt = '';
    account.lastMail = null;
    state.selectedAccountEmail = account.email;
    syncCurrentFromSelectedAccount();
    saveState();
    setBusy(true);
    renderCurrent();

    try {
      const data = await postHelper('/messages', buildMailPayload(account));
      const message = window.HotmailUtils.getLatestHotmailMessage(data.messages || []);
      if (!message) throw new Error('没有找到最新邮件');

      const sender = message.from?.emailAddress?.address || '';
      const bodyContent = String(message.body?.content || message.bodyPreview || '').trim();
      const explicitHtml = normalizeRenderableHtml(message.body?.html || '');
      const contentHtml = normalizeRenderableHtml(bodyContent);
      const mailHtml = explicitHtml || contentHtml;
      const mailContent = cleanExtractedText(bodyContent);
      const code = String(window.HotmailUtils.extractVerificationCode([
        message.subject,
        bodyContent,
        message.bodyPreview,
        sender,
      ].filter(Boolean).join(' ')) || '').trim();

      account.lastStatus = 'success';
      account.lastCode = code;
      account.lastFetchAt = String(message.receivedDateTime || new Date().toISOString());
      account.lastMail = {
        code,
        subject: String(message.subject || ''),
        content: mailContent,
        html: mailHtml,
        sender: String(sender || ''),
        receivedAt: String(message.receivedDateTime || ''),
      };
      if (data.nextRefreshToken) account.refreshToken = String(data.nextRefreshToken);

      state.selectedAccountEmail = account.email;
      syncCurrentFromSelectedAccount();
      showToast(code ? `已取到最新邮件，验证码 ${code}` : '已取到最新邮件', 'success');
    } catch (error) {
      account.lastStatus = 'failed';
      account.lastError = shortError(error);
      showToast(account.lastError, 'error');
    } finally {
      saveState();
      setBusy(false);
      render();
    }
  }

  function syncCurrentFromSelectedAccount() {
    const account = state.accounts.find((item) => accountId(item) === normalizeEmail(state.selectedAccountEmail));
    const mail = account?.lastMail;
    state.currentAccountEmail = account?.email || state.selectedAccountEmail || '';
    state.currentCode = String(mail?.code || account?.lastCode || '');
    state.currentSubject = String(mail?.subject || '');
    state.currentMailContent = String(mail?.content || '');
    state.currentMailHtml = String(mail?.html || '');
    state.currentSender = String(mail?.sender || '');
    state.currentReceivedAt = String(mail?.receivedAt || account?.lastFetchAt || '');
  }

  function selectAccount(email) {
    const account = state.accounts.find((item) => accountId(item) === normalizeEmail(email));
    if (!account) return;
    state.selectedAccountEmail = account.email;
    syncCurrentFromSelectedAccount();
    saveState();
    render();
  }

  function deleteAccount(email) {
    const deletedSelected = normalizeEmail(state.selectedAccountEmail) === normalizeEmail(email);
    state.accounts = state.accounts.filter((account) => accountId(account) !== normalizeEmail(email));
    if (deletedSelected) {
      state.selectedAccountEmail = '';
      syncCurrentFromSelectedAccount();
    }
    saveState();
    render();
    showToast('账号已删除');
  }

  function clearData() {
    if (!confirm('确认清空本地保存的账号？')) return;
    state.accounts = [];
    state.currentCode = '';
    state.currentAccountEmail = '';
    state.currentSubject = '';
    state.currentMailContent = '';
    state.currentMailHtml = '';
    state.currentSender = '';
    state.currentReceivedAt = '';
    state.selectedAccountEmail = '';
    saveState();
    render();
    showToast('已清空');
  }

  function sanitizeEmailHtml(htmlContent) {
    const template = document.createElement('template');
    template.innerHTML = String(htmlContent || '');
    template.content.querySelectorAll('script, iframe, object, embed').forEach((node) => node.remove());
    template.content.querySelectorAll('*').forEach((node) => {
      [...node.attributes].forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim().toLowerCase();
        if (name.startsWith('on') || value.startsWith('javascript:')) {
          node.removeAttribute(attribute.name);
        }
      });
    });
    return template.innerHTML;
  }

  function buildEmailDocument(htmlContent) {
    return `<!doctype html>
<html>
<head>
  <base target="_blank">
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { margin: 0; padding: 16px; color: #111827; font: 14px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #fff; }
    img { max-width: 100%; height: auto; }
    table { max-width: 100%; }
    a { color: #0f6fff; }
  </style>
</head>
<body>${sanitizeEmailHtml(htmlContent)}</body>
</html>`;
  }

  function renderCurrent() {
    const selectedAccount = state.accounts.find((account) => accountId(account) === normalizeEmail(state.selectedAccountEmail));
    const isLoading = selectedAccount?.lastStatus === 'running';
    const hasSelectedAccount = Boolean(state.currentAccountEmail || state.selectedAccountEmail);
    const hasMail = Boolean(state.currentSubject || state.currentMailContent || state.currentMailHtml);
    elements.currentCode.textContent = isLoading ? '取件中' : (state.currentCode || (hasMail ? '无验证码' : '------'));
    elements.currentCode.classList.toggle('empty-code', isLoading || (!state.currentCode && hasMail));
    elements.currentMeta.textContent = isLoading
      ? `${state.currentAccountEmail || state.selectedAccountEmail} ｜ 正在获取最新邮件...`
      : (hasMail
        ? `${state.currentAccountEmail || '当前账号'} ｜ ${state.currentSubject || '无标题'}${state.currentReceivedAt ? ` ｜ ${formatTime(state.currentReceivedAt)}` : ''}`
        : (hasSelectedAccount ? `${state.currentAccountEmail || state.selectedAccountEmail} ｜ 未取件` : '等待取件'));
    elements.copyCodeBtn.disabled = !state.currentCode;

    if (isLoading) {
      elements.mailDetail.className = 'mail-detail loading';
      elements.mailDetail.innerHTML = '<div class="loading-mail"><span class="loading-spinner"></span><strong>正在取件</strong><span>正在连接 Outlook 并读取最新邮件</span></div>';
      return;
    }

    if (!hasMail) {
      elements.mailDetail.className = 'mail-detail empty';
      elements.mailDetail.textContent = hasSelectedAccount ? '未取件' : '暂无邮件内容';
      return;
    }

    const htmlContent = state.currentMailHtml || normalizeRenderableHtml(state.currentMailContent);
    const iframeSrc = htmlContent
      ? buildEmailDocument(htmlContent)
      : buildEmailDocument(`<pre>${escapeHtml(state.currentMailContent)}</pre>`);

    elements.mailDetail.className = 'mail-detail';
    elements.mailDetail.innerHTML = `
      <div class="mail-detail-head">
        <strong>${escapeHtml(state.currentSubject || '无标题')}</strong>
      </div>
      <iframe class="mail-frame" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"></iframe>
    `;
    elements.mailDetail.querySelector('iframe').srcdoc = iframeSrc;
  }

  function renderAccounts() {
    const accounts = sortedAccounts();
    elements.accountCount.textContent = `${accounts.length} 个账号`;
    if (!accounts.length) {
      elements.accountsList.innerHTML = '<div class="empty-state">暂无账号，先粘贴账号并导入。</div>';
      return;
    }

    elements.accountsList.innerHTML = accounts.map((account) => {
      const disabled = state.busy ? 'disabled' : '';
      const selected = accountId(account) === normalizeEmail(state.selectedAccountEmail) ? ' selected' : '';
      const running = account.lastStatus === 'running' ? ' running' : '';
      return `
        <article class="account-card${selected}${running}" data-email="${escapeHtml(account.email)}">
          <div class="account-main">
            <span class="email" title="${escapeHtml(account.email)}">${escapeHtml(account.email)}</span>
            <div class="account-meta">
              <span>最近一封邮件 ${formatTime(account.lastFetchAt)}</span>
              <div class="account-actions">
                <button class="btn tiny primary" data-action="code" ${disabled}>${account.lastStatus === 'running' ? '取件中' : '取件'}</button>
                <button class="btn tiny danger ghost" data-action="delete">删除</button>
              </div>
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  function render() {
    renderCurrent();
    renderAccounts();
  }

  function bindEvents() {
    elements.themeToggleBtn.addEventListener('click', toggleTheme);
    elements.importBtn.addEventListener('click', importAccounts);
    elements.sampleBtn.addEventListener('click', () => {
      elements.importText.value = '账号----密码----ID----Token\nemail@example.com----password----clientId----refreshToken';
    });
    elements.clearDataBtn.addEventListener('click', clearData);
    elements.copyCodeBtn.addEventListener('click', () => copyText(state.currentCode, '验证码已复制'));
    elements.accountsList.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-action]');
      const card = event.target.closest('.account-card');
      if (!card) return;

      const email = card.dataset.email;
      const account = state.accounts.find((item) => accountId(item) === normalizeEmail(email));
      if (!account) return;

      if (!button) {
        selectAccount(email);
        return;
      }

      if (button.dataset.action === 'code') await fetchMailForAccount(email);
      if (button.dataset.action === 'delete') deleteAccount(email);
    });
  }

  loadState();
  applyTheme();
  if (state.selectedAccountEmail) syncCurrentFromSelectedAccount();
  bindEvents();
  render();
})();
