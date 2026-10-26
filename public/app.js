'use strict';

const $ = selector => document.querySelector(selector);
const STORAGE_KEY = 'contajusta.group';
const icons = ['⌂', '↗', '✳', '◉', '⌁', '✦'];
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const shortDate = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' });

const state = { groups: [], activeGroupId: readStoredGroup(), summaryRequest: 0 };
let toastTimer;

// ---------- utilitários ----------

async function api(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a ação.');
  return data;
}

const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body) });
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
const formatDate = sqlDate => shortDate.format(new Date(`${sqlDate.replace(' ', 'T')}Z`));

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function readStoredGroup() {
  try {
    return Number(localStorage.getItem(STORAGE_KEY)) || null;
  } catch {
    return null;
  }
}

function storeGroup(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* armazenamento indisponível: apenas não lembra o grupo */
  }
}

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
  state.groups = await api('/api/groups');
  selectGroup(state.groups.some(group => group.id === preferredId) ? preferredId : (state.groups[0]?.id ?? null));
}

function selectGroup(id) {
  state.activeGroupId = id;
  if (id) storeGroup(id);
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
    if (requestId === state.summaryRequest) renderSummary(summary);
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

function expenseRow(expense) {
  return `<div class="expense-row"><div class="expense-main"><span class="expense-symbol" aria-hidden="true">↗</span><div><div class="expense-desc">${escapeHtml(expense.description)}</div><div class="expense-note">${escapeHtml(expense.paidBy)} pagou · ${formatDate(expense.createdAt)}</div></div></div><span class="expense-amount">${money(expense.amountCents)}</span></div>`;
}

function settlementRow(settlement) {
  return `<div class="settlement-row"><span>${escapeHtml(settlement.fromName)} acertou com ${escapeHtml(settlement.toName)}</span><strong>${money(settlement.amountCents)}</strong></div>`;
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
      <div class="group-title"><span class="eyebrow">RESUMO DO GRUPO</span><h1>${escapeHtml(group.name)}</h1><p>${plural(members.length, 'participante', 'participantes')} · cada despesa é dividida igualmente</p></div>
      <div class="header-actions"><button class="button secondary small" id="add-member">+ Adicionar pessoa</button><button class="button primary small" id="add-expense">+ Nova despesa</button></div>
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
      <div class="expense-list">${expenses.length ? expenses.map(expenseRow).join('') : '<div class="empty-table"><strong>Ainda não tem despesas</strong>Quando alguém pagar por algo, adicione aqui.</div>'}</div>
    </section>
    ${settlements.length ? `<section class="panel stacked-panel"><div class="panel-head"><div><h2>Acertos registrados</h2><p>Pagamentos feitos entre participantes</p></div></div><div class="settlement-list">${settlements.map(settlementRow).join('')}</div></section>` : ''}`;

  $('#add-expense').addEventListener('click', () => openExpenseForm(members));
  $('#expense-shortcut').addEventListener('click', () => openExpenseForm(members));
  $('#add-member').addEventListener('click', openMemberForm);
  $('#settlement-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const [fromMember, toMember, amountCents] = $('#settlement-choice').value.split(':').map(Number);
    withSubmitLock(event.currentTarget, async () => {
      try {
        await post(`/api/groups/${state.activeGroupId}/settlements`, { fromMember, toMember, amountCents });
        toast('Acerto registrado. Saldo atualizado!');
        await loadSummary();
      } catch (error) {
        toast(error.message);
      }
    });
  });
}

// ---------- formulários ----------

// Abre um <dialog> modal: o navegador cuida do foco, do Esc e do fundo inerte.
function openFormDialog(html, onSubmit) {
  const dialog = document.createElement('dialog');
  dialog.className = 'form-dialog';
  dialog.innerHTML = html;
  const form = dialog.querySelector('form');
  const error = form.querySelector('.form-error');
  dialog.addEventListener('close', () => dialog.remove());
  dialog.addEventListener('click', event => {
    if (event.target === dialog || event.target.closest('[data-dismiss]')) dialog.close();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    error.textContent = '';
    withSubmitLock(form, async () => {
      try {
        await onSubmit(new FormData(form));
        dialog.close();
      } catch (exception) {
        error.textContent = exception.message;
      }
    });
  });
  document.body.append(dialog);
  dialog.showModal();
}

function openExpenseForm(members) {
  openFormDialog(
    `<form class="form-card">
      <button type="button" class="dialog-close" data-dismiss aria-label="Fechar">×</button>
      <span class="eyebrow">NOVA DESPESA</span><h2>O que entrou na conta?</h2><p>Dividimos o valor igualmente entre as pessoas do grupo.</p>
      <label for="expense-description">Descrição</label><input id="expense-description" name="description" minlength="2" maxlength="100" placeholder="Ex.: Mercado da viagem" required autofocus>
      <label for="expense-amount">Valor total (R$)</label><input id="expense-amount" name="amount" type="number" min="0.01" max="1000000" step="0.01" inputmode="decimal" placeholder="0,00" required>
      <label for="expense-paid-by">Quem pagou?</label><select id="expense-paid-by" name="paidBy" required>${members.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')}</select>
      <p class="form-error" role="alert"></p><button class="button primary full" type="submit">Salvar despesa <span>→</span></button>
    </form>`,
    async form => {
      await post(`/api/groups/${state.activeGroupId}/expenses`, {
        description: form.get('description'),
        amount: form.get('amount'),
        paidBy: Number(form.get('paidBy')),
      });
      toast('Despesa adicionada e dividida pelo grupo!');
      await loadSummary();
    },
  );
}

function openMemberForm() {
  openFormDialog(
    `<form class="form-card">
      <button type="button" class="dialog-close" data-dismiss aria-label="Fechar">×</button>
      <span class="eyebrow">MAIS UMA PESSOA</span><h2>Quem faltou no grupo?</h2><p>A pessoa entra nos próximos rateios do grupo.</p>
      <label for="member-name">Nome</label><input id="member-name" name="name" minlength="2" maxlength="50" placeholder="Nome da pessoa" required autofocus>
      <p class="form-error" role="alert"></p><button class="button primary full" type="submit">Adicionar pessoa <span>→</span></button>
    </form>`,
    async form => {
      await post(`/api/groups/${state.activeGroupId}/members`, { name: form.get('name') });
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
$('#group-list').addEventListener('click', event => {
  const button = event.target.closest('[data-group]');
  if (button) selectGroup(Number(button.dataset.group));
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
      $('#group-dialog').close();
      toast('Grupo criado. Bora acertar as contas!');
      await loadGroups(group.id);
    } catch (error) {
      $('#dialog-error').textContent = error.message;
    }
  });
});

loadGroups().catch(error => {
  $('#content').innerHTML = `<div class="welcome"><h1>Opa, algo deu errado</h1><p>${escapeHtml(error.message)}</p></div>`;
});
