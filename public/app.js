'use strict';

const $ = selector => document.querySelector(selector);
const STORAGE = { groups: 'contajusta.groups', active: 'contajusta.active' };
const GROUP_PATH = /^\/g\/([A-Za-z0-9_-]{16,64})\/?$/;
const icons = ['⌂', '↗', '✳', '◉', '⌁', '✦'];
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const shortDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });
const dateTime = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const HISTORY_LABELS = { created: 'Criada', updated: 'Editada', deleted: 'Excluída' };

const state = { groups: [], activeGroupId: readStorage(STORAGE.active, null), summaryRequest: 0, summary: null };
let toastTimer;

// ---------- utilitários ----------

async function api(url, options = {}) {
  let response;
  try {
    response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  } catch {
    // fetch só rejeita em falha de rede.
    throw new Error(
      navigator.onLine
        ? 'Não foi possível falar com o servidor. Tente de novo.'
        : 'Você está offline. Conecte-se para ver e editar as contas.',
    );
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a ação.');
  return data;
}

const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body) });
const put = (url, body) => api(url, { method: 'PUT', body: JSON.stringify(body) });
const del = url => api(url, { method: 'DELETE' });
const groupUrl = path => `/api/groups/${state.activeGroupId}${path}`;
const money = cents => currency.format(cents / 100);
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const initials = name =>
  name
    .split(' ')
    .slice(0, 2)
    .map(part => part[0])
    .join('')
    .toLocaleUpperCase('pt-BR');
// O SQLite grava CURRENT_TIMESTAMP em UTC no formato "AAAA-MM-DD HH:MM:SS".
const parseSqlDate = sqlDate => new Date(`${sqlDate.replace(' ', 'T')}Z`);
const formatDate = sqlDate => shortDate.format(parseSqlDate(sqlDate));
const formatDateTime = sqlDate => dateTime.format(parseSqlDate(sqlDate));
// Apenas para feedback visual; o servidor faz a conversão autoritativa.
const toCents = value => Math.round((Number.parseFloat(String(value).replace(',', '.')) || 0) * 100);
const centsToInput = cents => (cents / 100).toFixed(2);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

// localStorage pode lançar (modo privado, cota); falha vira valor padrão.
function readStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sem persistência: o app segue funcionando na sessão atual */
  }
}

// Chaves dos grupos que este dispositivo conhece; a mais recente primeiro.
const knownKeys = () => readStorage(STORAGE.groups, []).filter(key => typeof key === 'string');
const rememberKey = key => writeStorage(STORAGE.groups, [key, ...knownKeys().filter(k => k !== key)]);
const forgetKey = key =>
  writeStorage(
    STORAGE.groups,
    knownKeys().filter(k => k !== key),
  );
const inviteUrl = key => `${location.origin}/g/${key}`;

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.remove('show'), 2600);
}

// Desabilita o botão de envio enquanto a requisição está em andamento, evitando cadastros duplicados.
async function withSubmitLock(form, action) {
  const button = form.querySelector('button[type="submit"], button:not([type])');
  if (button?.disabled) return;
  if (button) button.disabled = true;
  try {
    await action();
  } finally {
    if (button) button.disabled = false;
  }
}

// ---------- dados ----------

async function loadGroups(preferredId = state.activeGroupId) {
  const keys = knownKeys();
  state.groups = keys.length ? await api(`/api/groups?ids=${keys.join(',')}`) : [];
  // Remove chaves de grupos que não existem mais.
  const found = new Set(state.groups.map(group => group.id));
  writeStorage(
    STORAGE.groups,
    keys.filter(key => found.has(key)),
  );
  state.groups.sort((a, b) => keys.indexOf(a.id) - keys.indexOf(b.id));
  selectGroup(found.has(preferredId) ? preferredId : (state.groups[0]?.id ?? null));
}

function selectGroup(id) {
  state.activeGroupId = id;
  writeStorage(STORAGE.active, id);
  history.replaceState(null, '', id ? `/g/${id}` : '/');
  renderGroups();
  if (id) loadSummary();
  else renderWelcome();
}

async function loadSummary() {
  const requestId = ++state.summaryRequest;
  const groupId = state.activeGroupId;
  $('#content').innerHTML = '<div class="welcome"><span class="spin"></span><p>Atualizando as contas...</p></div>';
  try {
    const summary = await api(`/api/groups/${groupId}/summary`);
    // Ignora respostas atrasadas quando a pessoa já trocou de grupo.
    if (requestId !== state.summaryRequest) return;
    state.summary = summary;
    renderSummary(summary);
  } catch (error) {
    if (requestId !== state.summaryRequest) return;
    $('#content').innerHTML =
      `<div class="welcome"><h1>Não consegui carregar</h1><p>${escapeHtml(error.message)}</p><button class="button secondary" id="retry">Tentar de novo</button></div>`;
    $('#retry').addEventListener('click', loadSummary);
  }
}

// ---------- renderização ----------

function renderGroups() {
  $('#group-list').innerHTML = state.groups
    .map(
      (group, index) => `
    <button class="group-item ${group.id === state.activeGroupId ? 'active' : ''}" data-group="${group.id}" ${group.id === state.activeGroupId ? 'aria-current="true"' : ''}>
      <span class="group-symbol" aria-hidden="true">${icons[index % icons.length]}</span>
      <span class="group-meta"><span>${escapeHtml(group.name)}</span><small>${plural(group.members.length, 'pessoa', 'pessoas')}</small></span>
    </button>`,
    )
    .join('');
}

function renderWelcome() {
  $('#content').innerHTML =
    `<div class="welcome"><div class="welcome-art" aria-hidden="true">↗</div><span class="eyebrow">A CONTA FECHA. A AMIZADE TAMBÉM.</span><h1>Dividir ficou mais leve.</h1><p>Organize as despesas da viagem, da casa ou daquele jantar. Todo mundo sabe o que pagou e o que falta.</p><button class="button primary" id="welcome-new">Criar meu primeiro grupo <span>→</span></button></div>`;
  $('#welcome-new').addEventListener('click', openGroupDialog);
}

const avatar = name => `<span class="avatar" aria-hidden="true">${escapeHtml(initials(name))}</span>`;

function balanceRow(member) {
  const tone = member.balanceCents > 0 ? 'positive' : member.balanceCents < 0 ? 'negative' : 'neutral';
  const status = member.balanceCents > 0 ? 'tem a receber' : member.balanceCents < 0 ? 'falta acertar' : 'está em dia';
  return `<div class="balance-row"><div class="person-cell">${avatar(member.name)}<div><div class="person-name">${escapeHtml(member.name)}</div><div class="person-note">${status} · pagou ${money(member.paidCents)}, parte ${money(member.shareCents)}</div></div></div><span class="balance-amount ${tone}">${money(Math.abs(member.balanceCents))}</span></div>`;
}

function transferRow(transfer) {
  return `<div class="transfer-row"><div class="transfer-main">${avatar(transfer.from)}<div><div class="transfer-names">${escapeHtml(transfer.from)} <span class="transfer-arrow">→</span> ${escapeHtml(transfer.to)}</div><div class="transfer-note">acerto sugerido</div></div></div><span class="balance-amount">${money(transfer.amountCents)}</span></div>`;
}

function splitLabel(expense, memberCount) {
  if (expense.splitMode === 'exact') return 'valores por pessoa';
  return expense.shares.length === memberCount ? 'igual para todos' : `igual entre ${expense.shares.length}`;
}

function expenseRow(expense, memberCount) {
  const edited = expense.updatedAt ? ' · editada' : '';
  return `<div class="expense-row">
    <div class="expense-main"><span class="expense-symbol" aria-hidden="true">↗</span><div><div class="expense-desc">${escapeHtml(expense.description)}</div><div class="expense-note">${escapeHtml(expense.paidBy)} pagou · ${formatDate(expense.createdAt)} · ${splitLabel(expense, memberCount)}${edited}</div></div></div>
    <div class="row-end"><span class="expense-amount">${money(expense.amountCents)}</span>
      <div class="row-actions">
        <button class="text-button" data-action="edit-expense" data-id="${expense.id}">Editar</button>
        <button class="text-button muted" data-action="expense-history" data-id="${expense.id}">Histórico</button>
        <button class="text-button danger" data-action="delete-expense" data-id="${expense.id}">Excluir</button>
      </div>
    </div>
  </div>`;
}

function settlementRow(settlement) {
  return `<div class="settlement-row"><span>${escapeHtml(settlement.fromName)} acertou com ${escapeHtml(settlement.toName)} · ${formatDate(settlement.createdAt)}</span><span class="row-end-inline"><strong>${money(settlement.amountCents)}</strong><button class="text-button danger" data-action="undo-settlement" data-id="${settlement.id}">Desfazer</button></span></div>`;
}

function renderSummary({ group, members, expenses, settlements, balances, transfers }) {
  const total = expenses.reduce((sum, expense) => sum + expense.amountCents, 0);
  const average = members.length ? Math.round(total / members.length) : 0;
  const transferOptions = transfers
    .map(
      t =>
        `<option value="${t.fromId}:${t.toId}:${t.amountCents}">${escapeHtml(t.from)} → ${escapeHtml(t.to)} (${money(t.amountCents)})</option>`,
    )
    .join('');

  $('#content').innerHTML = `
    <div class="group-header">
      <div class="group-title"><span class="eyebrow">RESUMO DO GRUPO</span><h1>${escapeHtml(group.name)}</h1><p>${plural(members.length, 'participante', 'participantes')} · divisão igual ou personalizada por despesa</p></div>
      <div class="header-actions"><button class="button secondary small" id="invite">Convidar</button><button class="button secondary small" id="add-member">+ Adicionar pessoa</button><button class="button primary small" id="add-expense">+ Nova despesa</button></div>
    </div>
    <div class="summary-grid">
      <article class="summary-card"><div class="summary-label"><span aria-hidden="true">↗</span>Total das despesas</div><div class="summary-value">${money(total)}</div><div class="summary-foot">${plural(expenses.length, 'despesa registrada', 'despesas registradas')}</div></article>
      <article class="summary-card"><div class="summary-label"><span aria-hidden="true">◉</span>Média por pessoa</div><div class="summary-value">${money(average)}</div><div class="summary-foot">total dividido por ${plural(members.length, 'pessoa', 'pessoas')}</div></article>
      <article class="summary-card"><div class="summary-label"><span aria-hidden="true">✓</span>Acertos pendentes</div><div class="summary-value">${transfers.length}</div><div class="summary-foot">transferências para zerar o saldo</div></article>
    </div>
    <div class="grid-two">
      <section class="panel"><div class="panel-head"><div><h2>Quem deve o quê</h2><p>Saldos atualizados do grupo</p></div><span class="eyebrow">${members.length} PESSOAS</span></div><div class="balance-list">${balances.map(balanceRow).join('')}</div></section>
      <section class="panel"><div class="panel-head"><div><h2>Acertos sugeridos</h2><p>Menos transferências, conta fechada</p></div></div>
        <div class="transfer-list">${transfers.length ? transfers.map(transferRow).join('') : '<div class="empty-state"><strong>Todo mundo está em dia ✨</strong>Nenhum acerto pendente por aqui.</div>'}</div>
        ${transfers.length ? `<form class="settlement-box" id="settlement-form"><p>Registre um pagamento feito entre as pessoas e atualize os saldos.</p><div class="settle-form"><select id="settlement-choice" aria-label="Acerto para registrar" required>${transferOptions}</select><button class="button primary small" type="submit">Registrar</button></div></form>` : ''}
      </section>
    </div>
    <section class="panel table-panel"><div class="panel-head"><div><h2>Despesas do grupo</h2><p>Quem pagou e quanto foi</p></div><button id="expense-shortcut" class="text-button">+ Adicionar despesa</button></div>
      <div class="expense-list">${expenses.length ? expenses.map(expense => expenseRow(expense, members.length)).join('') : '<div class="empty-table"><strong>Ainda não tem despesas</strong>Quando alguém pagar por algo, adicione aqui.</div>'}</div>
    </section>
    ${settlements.length ? `<section class="panel stacked-panel"><div class="panel-head"><div><h2>Acertos registrados</h2><p>Pagamentos feitos entre participantes</p></div></div><div class="settlement-list">${settlements.map(settlementRow).join('')}</div></section>` : ''}`;

  $('#add-expense').addEventListener('click', () => openExpenseForm(members));
  $('#expense-shortcut').addEventListener('click', () => openExpenseForm(members));
  $('#add-member').addEventListener('click', openMemberForm);
  $('#invite').addEventListener('click', () => openInviteDialog(group));
  $('#settlement-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const [fromMember, toMember, amountCents] = $('#settlement-choice').value.split(':').map(Number);
    withSubmitLock(event.currentTarget, async () => {
      try {
        await post(groupUrl('/settlements'), { fromMember, toMember, amountCents });
        toast('Acerto registrado. Saldo atualizado!');
        await loadSummary();
      } catch (error) {
        toast(error.message);
      }
    });
  });
}

// ---------- diálogos ----------

const closeButton = '<button type="button" class="dialog-close" data-dismiss aria-label="Fechar">×</button>';

// <dialog> modal: o navegador cuida do foco, do Esc e do fundo inerte. Removido do DOM ao fechar.
function openDialog(html) {
  const dialog = document.createElement('dialog');
  dialog.className = 'form-dialog';
  dialog.innerHTML = html;
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', event => {
    if (event.target === dialog || event.target.closest('[data-dismiss]')) dialog.close();
  });
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

// onSubmit(formData, form) lança erro para manter o diálogo aberto com a mensagem.
function openFormDialog(html, onSubmit) {
  const dialog = openDialog(html);
  const form = dialog.querySelector('form');
  const error = form.querySelector('.form-error');
  form.addEventListener('submit', event => {
    event.preventDefault();
    error.textContent = '';
    withSubmitLock(form, async () => {
      try {
        await onSubmit(new FormData(form), form);
        dialog.close();
      } catch (exception) {
        error.textContent = exception.message;
      }
    });
  });
  return dialog;
}

function confirmAction({ eyebrow, title, message, confirmLabel, onConfirm }) {
  openFormDialog(
    `<form class="form-card">
      ${closeButton}
      <span class="eyebrow">${eyebrow}</span><h2>${title}</h2><p>${message}</p>
      <p class="form-error" role="alert"></p>
      <div class="dialog-actions"><button type="button" class="button secondary" data-dismiss>Cancelar</button><button class="button danger" type="submit" autofocus>${confirmLabel}</button></div>
    </form>`,
    onConfirm,
  );
}

// ---------- despesas ----------

function splitFieldset(members, expense) {
  const mode = expense?.splitMode ?? 'equal';
  const shareOf = new Map((expense?.shares ?? []).map(share => [share.memberId, share.amountCents]));
  const included = id => !expense || shareOf.has(id);
  const items = members
    .map(
      m => `<div class="split-item">
        <label class="split-check"><input type="checkbox" name="equalMember" value="${m.id}" ${included(m.id) ? 'checked' : ''}><span>${escapeHtml(m.name)}</span></label>
        <input class="split-amount" name="share-${m.id}" data-member="${m.id}" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0,00" aria-label="Valor de ${escapeHtml(m.name)}" value="${mode === 'exact' && shareOf.has(m.id) ? centsToInput(shareOf.get(m.id)) : ''}">
      </div>`,
    )
    .join('');
  return `<fieldset class="split-field" data-mode="${mode}">
      <legend>Como dividir?</legend>
      <div class="segmented">
        <label><input type="radio" name="splitMode" value="equal" ${mode === 'equal' ? 'checked' : ''}><span>Igual</span></label>
        <label><input type="radio" name="splitMode" value="exact" ${mode === 'exact' ? 'checked' : ''}><span>Valores exatos</span></label>
      </div>
      <div class="split-list">${items}</div>
      <p class="split-hint" aria-live="polite"></p>
    </fieldset>`;
}

// Converte o estado do formulário no contrato `split` da API.
function readSplit(form) {
  const mode = form.querySelector('[name="splitMode"]:checked').value;
  if (mode === 'equal') {
    return { mode, memberIds: [...form.querySelectorAll('[name="equalMember"]:checked')].map(input => Number(input.value)) };
  }
  const shares = [...form.querySelectorAll('.split-amount')]
    .filter(input => input.value !== '')
    .map(input => ({ memberId: Number(input.dataset.member), amount: input.value }));
  return { mode, shares };
}

// Atualiza modo visível e resumo (valor por pessoa ou quanto falta distribuir).
function bindSplitPreview(form) {
  const fieldset = form.querySelector('.split-field');
  const hint = form.querySelector('.split-hint');
  const amounts = [...form.querySelectorAll('.split-amount')];
  form.addEventListener('change', event => {
    if (event.target.name !== 'splitMode' || event.target.value !== 'exact' || amounts.some(input => input.value !== '')) return;
    const ids = amounts.map(input => Number(input.dataset.member));
    const totalCents = toCents(form.elements.amount.value);
    if (!totalCents) return;
    const quotient = Math.floor(totalCents / ids.length);
    const remainder = totalCents % ids.length;
    amounts.forEach((input, index) => (input.value = centsToInput(quotient + (index < remainder ? 1 : 0))));
    update();
  });
  const update = () => {
    const split = readSplit(form);
    const totalCents = toCents(form.elements.amount.value);
    fieldset.dataset.mode = split.mode;
    // Campos do modo inativo saem da validação nativa e do envio.
    for (const input of amounts) input.disabled = split.mode !== 'exact';
    for (const input of form.querySelectorAll('[name="equalMember"]')) input.disabled = split.mode !== 'equal';
    if (split.mode === 'equal') {
      const count = split.memberIds.length;
      hint.textContent = count
        ? `${money(Math.floor(totalCents / count))} por pessoa · ${plural(count, 'pessoa', 'pessoas')}`
        : 'Selecione quem divide.';
      hint.dataset.state = count ? 'ok' : 'error';
      return;
    }
    if (!totalCents) {
      hint.textContent = 'Informe o valor total para distribuir.';
      hint.dataset.state = 'error';
      return;
    }
    const diff = totalCents - split.shares.reduce((sum, share) => sum + toCents(share.amount), 0);
    hint.textContent =
      diff === 0 ? 'Valores fecham com o total ✓' : diff > 0 ? `Faltam ${money(diff)} para distribuir` : `Passou ${money(-diff)} do total`;
    hint.dataset.state = diff === 0 ? 'ok' : 'error';
  };
  form.addEventListener('input', update);
  update();
}

function openExpenseForm(members, expense = null) {
  const editing = Boolean(expense);
  const memberOptions = members
    .map(m => `<option value="${m.id}" ${expense?.paidById === m.id ? 'selected' : ''}>${escapeHtml(m.name)}</option>`)
    .join('');
  const dialog = openFormDialog(
    `<form class="form-card">
      ${closeButton}
      <span class="eyebrow">${editing ? 'EDITAR DESPESA' : 'NOVA DESPESA'}</span><h2>${editing ? 'Ajustar a despesa' : 'O que entrou na conta?'}</h2>
      <p>${editing ? 'A alteração fica registrada no histórico.' : 'Divida igualmente ou informe quanto cabe a cada um.'}</p>
      <label for="expense-description">Descrição</label><input id="expense-description" name="description" minlength="2" maxlength="100" placeholder="Ex.: Mercado da viagem" value="${escapeHtml(expense?.description ?? '')}" required autofocus>
      <label for="expense-amount">Valor total (R$)</label><input id="expense-amount" name="amount" type="number" min="0.01" max="1000000" step="0.01" inputmode="decimal" placeholder="0,00" value="${expense ? centsToInput(expense.amountCents) : ''}" required>
      <label for="expense-paid-by">Quem pagou?</label><select id="expense-paid-by" name="paidBy" required>${memberOptions}</select>
      ${splitFieldset(members, expense)}
      <p class="form-error" role="alert"></p><button class="button primary full" type="submit">${editing ? 'Salvar alterações' : 'Salvar despesa'} <span>→</span></button>
    </form>`,
    async (formData, form) => {
      const body = {
        description: formData.get('description'),
        amount: formData.get('amount'),
        paidBy: Number(formData.get('paidBy')),
        split: readSplit(form),
      };
      if (editing) await put(groupUrl(`/expenses/${expense.id}`), body);
      else await post(groupUrl('/expenses'), body);
      toast(editing ? 'Despesa atualizada!' : 'Despesa adicionada!');
      await loadSummary();
    },
  );
  bindSplitPreview(dialog.querySelector('form'));
}

function confirmDeleteExpense(expense) {
  confirmAction({
    eyebrow: 'EXCLUIR DESPESA',
    title: 'Excluir esta despesa?',
    message: `"${escapeHtml(expense.description)}" (${money(expense.amountCents)}) sai dos saldos, mas continua no histórico.`,
    confirmLabel: 'Excluir',
    onConfirm: async () => {
      await del(groupUrl(`/expenses/${expense.id}`));
      toast('Despesa excluída.');
      await loadSummary();
    },
  });
}

function historyEntry(event, nameOf) {
  const { snapshot } = event;
  const split =
    snapshot.splitMode === 'exact' ? 'valores por pessoa' : `igual entre ${plural(snapshot.shares.length, 'pessoa', 'pessoas')}`;
  return `<li class="history-item" data-action-type="${event.action}">
    <div class="history-head"><strong>${HISTORY_LABELS[event.action]}</strong><span>${formatDateTime(event.createdAt)}</span></div>
    <div class="history-body">${escapeHtml(snapshot.description)} · ${money(snapshot.amountCents)} · pago por ${escapeHtml(nameOf(snapshot.paidBy))} · ${split}</div>
  </li>`;
}

async function openExpenseHistory(expense) {
  try {
    const events = await api(groupUrl(`/expenses/${expense.id}/history`));
    const names = new Map(state.summary.members.map(m => [m.id, m.name]));
    const nameOf = id => names.get(id) ?? 'pessoa removida';
    openDialog(`<div class="form-card">
      ${closeButton}
      <span class="eyebrow">HISTÓRICO</span><h2>${escapeHtml(expense.description)}</h2><p>Cada criação, edição e exclusão fica registrada.</p>
      <ol class="history-list">${events
        .slice()
        .reverse()
        .map(event => historyEntry(event, nameOf))
        .join('')}</ol>
    </div>`);
  } catch (error) {
    toast(error.message);
  }
}

function confirmUndoSettlement(settlement) {
  confirmAction({
    eyebrow: 'DESFAZER ACERTO',
    title: 'Desfazer este acerto?',
    message: `${escapeHtml(settlement.fromName)} → ${escapeHtml(settlement.toName)} (${money(settlement.amountCents)}). Os saldos voltam a considerar a dívida.`,
    confirmLabel: 'Desfazer',
    onConfirm: async () => {
      await del(groupUrl(`/settlements/${settlement.id}`));
      toast('Acerto desfeito.');
      await loadSummary();
    },
  });
}

// Delegação: os botões são recriados a cada render, o listener não.
const actions = {
  'edit-expense': id =>
    openExpenseForm(
      state.summary.members,
      state.summary.expenses.find(e => e.id === id),
    ),
  'expense-history': id => openExpenseHistory(state.summary.expenses.find(e => e.id === id)),
  'delete-expense': id => confirmDeleteExpense(state.summary.expenses.find(e => e.id === id)),
  'undo-settlement': id => confirmUndoSettlement(state.summary.settlements.find(s => s.id === id)),
};

// ---------- grupos e pessoas ----------

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// Quem tem o link acessa o grupo: é o modelo de acesso, sem contas.
function openInviteDialog(group) {
  const url = inviteUrl(group.id);
  const canShare = typeof navigator.share === 'function';
  const dialog = openDialog(`<div class="form-card">
      ${closeButton}
      <span class="eyebrow">CONVIDAR</span><h2>Chame o pessoal</h2>
      <p>Quem tiver este link pode ver e editar as contas de <strong>${escapeHtml(group.name)}</strong>. Compartilhe só com o grupo.</p>
      <label for="invite-link">Link do grupo</label>
      <div class="copy-field"><input id="invite-link" value="${escapeHtml(url)}" readonly><button class="button primary small" type="button" data-copy>Copiar</button></div>
      ${canShare ? '<button class="button secondary full" type="button" data-share>Compartilhar…</button>' : ''}
      <button class="text-button danger forget-button" type="button" data-forget>Remover este grupo deste dispositivo</button>
    </div>`);
  const input = dialog.querySelector('#invite-link');
  input.addEventListener('focus', () => input.select());
  dialog.querySelector('[data-copy]').addEventListener('click', async () => {
    if (await copyText(url)) toast('Link copiado!');
    else input.select();
  });
  dialog
    .querySelector('[data-share]')
    ?.addEventListener('click', () =>
      navigator.share({ title: `ContaJusta · ${group.name}`, text: `Entre no grupo "${group.name}" no ContaJusta`, url }).catch(() => {}),
    );
  dialog.querySelector('[data-forget]').addEventListener('click', async () => {
    forgetKey(group.id);
    dialog.close();
    toast('Grupo removido deste dispositivo. O link continua funcionando.');
    await loadGroups(null);
  });
}

function openMemberForm() {
  openFormDialog(
    `<form class="form-card">
      ${closeButton}
      <span class="eyebrow">MAIS UMA PESSOA</span><h2>Quem faltou no grupo?</h2><p>A pessoa entra nos próximos rateios do grupo.</p>
      <label for="member-name">Nome</label><input id="member-name" name="name" minlength="2" maxlength="50" placeholder="Nome da pessoa" required autofocus>
      <p class="form-error" role="alert"></p><button class="button primary full" type="submit">Adicionar pessoa <span>→</span></button>
    </form>`,
    async form => {
      await post(groupUrl('/members'), { name: form.get('name') });
      toast('Pessoa adicionada! Ela participa dos próximos rateios.');
      await loadGroups(state.activeGroupId);
    },
  );
}

function openGroupDialog() {
  $('#dialog-error').textContent = '';
  $('#group-form').reset();
  $('#group-dialog').showModal();
}

// ---------- eventos globais ----------

$('#new-group-open').addEventListener('click', openGroupDialog);
$('[data-close-dialog]').addEventListener('click', () => $('#group-dialog').close());
$('#content').addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (button && state.summary) actions[button.dataset.action]?.(Number(button.dataset.id));
});
$('#group-list').addEventListener('click', event => {
  const button = event.target.closest('[data-group]');
  if (button) selectGroup(button.dataset.group);
});
$('#group-form').addEventListener('submit', event => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const form = new FormData(formElement);
  const members = String(form.get('members'))
    .split(/[,\n;]/)
    .map(name => name.trim())
    .filter(Boolean);
  withSubmitLock(formElement, async () => {
    try {
      const group = await post('/api/groups', { name: form.get('name'), members });
      rememberKey(group.id);
      $('#group-dialog').close();
      toast('Grupo criado. Bora acertar as contas!');
      await loadGroups(group.id);
    } catch (error) {
      $('#dialog-error').textContent = error.message;
    }
  });
});

// Abrir um link /g/<chave> adiciona o grupo à lista deste dispositivo.
function boot() {
  const linkedKey = GROUP_PATH.exec(location.pathname)?.[1];
  if (linkedKey) rememberKey(linkedKey);
  return loadGroups(linkedKey ?? state.activeGroupId).then(() => {
    if (linkedKey && state.activeGroupId !== linkedKey) toast('Link de grupo inválido ou expirado.');
  });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

function start() {
  boot().catch(error => {
    $('#content').innerHTML =
      `<div class="welcome"><h1>Não consegui carregar</h1><p>${escapeHtml(error.message)}</p><button class="button secondary" id="retry-boot">Tentar de novo</button></div>`;
    $('#retry-boot').addEventListener('click', start);
  });
}

window.addEventListener('online', () => {
  if (!state.summary) start();
});
start();
