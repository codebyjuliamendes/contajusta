const $ = selector => document.querySelector(selector);
const api = async (url, options = {}) => {
  const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a ação.');
  return data;
};
const money = cents => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
const initials = name => name.split(' ').slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase('pt-BR');
const icons = ['⌂', '↗', '✳', '◉', '⌁', '✦'];
let groups = [], activeGroupId = Number(localStorage.getItem('contajusta.group')) || null, toastTimer;

function toast(message) {
  const element = $('#toast'); element.textContent = message; element.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove('show'), 2600);
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function groupLabel(group) { return `${group.members.length} ${group.members.length === 1 ? 'pessoa' : 'pessoas'}`; }

async function loadGroups(preferredId = activeGroupId) {
  groups = await api('/api/groups');
  if (!groups.some(group => group.id === preferredId)) preferredId = groups[0]?.id || null;
  activeGroupId = preferredId; if (activeGroupId) localStorage.setItem('contajusta.group', activeGroupId);
  renderGroups();
  if (activeGroupId) await loadSummary(); else renderWelcome();
}

function renderGroups() {
  $('#group-list').innerHTML = groups.map((group, index) => `<button class="group-item ${group.id === activeGroupId ? 'active' : ''}" data-group="${group.id}"><span class="group-symbol">${icons[index % icons.length]}</span><span class="group-meta"><span>${escapeHtml(group.name)}</span><small>${groupLabel(group)}</small></span></button>`).join('');
}

function renderWelcome() {
  $('#content').innerHTML = `<div class="welcome"><div class="welcome-art">↗</div><span class="eyebrow">A CONTA FECHA. A AMIZADE TAMBÉM.</span><h1>Dividir ficou mais leve.</h1><p>Organize as despesas da viagem, da casa ou daquele jantar. Todo mundo sabe o que pagou e o que falta.</p><button class="button primary" id="welcome-new">Criar meu primeiro grupo <span>→</span></button></div>`;
  $('#welcome-new').addEventListener('click', openDialog);
}

async function loadSummary() {
  const content = $('#content'); content.innerHTML = `<div class="welcome"><span class="spin"></span><p>Atualizando as contas...</p></div>`;
  try { renderSummary(await api(`/api/groups/${activeGroupId}/summary`)); }
  catch (error) { content.innerHTML = `<div class="welcome"><h1>Não consegui carregar</h1><p>${escapeHtml(error.message)}</p><button class="button secondary" id="retry">Tentar de novo</button></div>`; $('#retry').onclick = loadSummary; }
}

function renderSummary(data) {
  const { group, members, expenses, settlements, balances, transfers } = data;
  const total = expenses.reduce((sum, expense) => sum + expense.amountCents, 0);
  const perPerson = members.length ? Math.round(total / members.length) : 0;
  const balanceRows = balances.map(member => {
    const amountClass = member.balanceCents > 0 ? 'positive' : member.balanceCents < 0 ? 'negative' : 'neutral';
    const status = member.balanceCents > 0 ? 'tem a receber' : member.balanceCents < 0 ? 'falta acertar' : 'está em dia';
    return `<div class="balance-row"><div class="person-cell"><span class="avatar">${initials(escapeHtml(member.name))}</span><div><div class="person-name">${escapeHtml(member.name)}</div><div class="person-note">${status}</div></div></div><span class="balance-amount ${amountClass}">${money(Math.abs(member.balanceCents))}</span></div>`;
  }).join('');
  const transferRows = transfers.length ? transfers.map(transfer => `<div class="transfer-row"><div class="transfer-main"><span class="avatar">${initials(escapeHtml(transfer.from))}</span><div><div class="transfer-names">${escapeHtml(transfer.from)} <span class="transfer-arrow">→</span> ${escapeHtml(transfer.to)}</div><div class="transfer-note">acerto sugerido</div></div></div><span class="balance-amount">${money(transfer.amountCents)}</span></div>`).join('') : `<div class="empty-state"><strong>Todo mundo está em dia ✨</strong>Nenhum acerto pendente por aqui.</div>`;
  const expenseRows = expenses.length ? expenses.map(expense => `<div class="expense-row"><div class="expense-main"><span class="expense-symbol">↗</span><div><div class="expense-desc">${escapeHtml(expense.description)}</div><div class="expense-note">${escapeHtml(expense.paidBy)} pagou · ${new Date(expense.createdAt.replace(' ', 'T') + 'Z').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</div></div></div><span class="expense-amount">${money(expense.amountCents)}</span></div>`).join('') : `<div class="empty-table"><strong>Ainda não tem despesas</strong>Quando alguém pagar por algo, adicione aqui.</div>`;
  const memberOptions = members.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');
  const settlementRows = settlements.map(s => `<div class="settlement-row"><span>${escapeHtml(s.fromName)} acertou com ${escapeHtml(s.toName)}</span><strong>${money(s.amountCents)}</strong></div>`).join('');
  const transferOptions = transfers.map(t => `<option value="${t.fromId}:${t.toId}:${t.amountCents}">${escapeHtml(t.from)} → ${escapeHtml(t.to)} (${money(t.amountCents)})</option>`).join('');
  $('#content').innerHTML = `<div class="group-header"><div class="group-title"><span class="eyebrow">RESUMO DO GRUPO</span><h1>${escapeHtml(group.name)}</h1><p>${members.length} participantes · cada pessoa divide o valor igualmente</p></div><div class="header-actions"><button class="button secondary small" id="add-member">+ Adicionar pessoa</button><button class="button primary small" id="add-expense">+ Nova despesa</button></div></div>
    <div class="summary-grid"><article class="summary-card"><div class="summary-label"><span>↗</span>Total das despesas</div><div class="summary-value">${money(total)}</div><div class="summary-foot">${expenses.length} ${expenses.length === 1 ? 'despesa registrada' : 'despesas registradas'}</div></article><article class="summary-card"><div class="summary-label"><span>◉</span>Por pessoa</div><div class="summary-value">${money(perPerson)}</div><div class="summary-foot">dividido entre ${members.length} pessoas</div></article><article class="summary-card"><div class="summary-label"><span>✓</span>Acertos pendentes</div><div class="summary-value">${transfers.length}</div><div class="summary-foot">transferências para zerar o saldo</div></article></div>
    <div class="grid-two"><section class="panel"><div class="panel-head"><div><h2>Quem deve o quê</h2><p>Saldos atualizados do grupo</p></div><span class="eyebrow">${members.length} PESSOAS</span></div><div class="balance-list">${balanceRows}</div></section><section class="panel"><div class="panel-head"><div><h2>Acertos sugeridos</h2><p>Menos transferências, conta fechada</p></div></div><div class="transfer-list">${transferRows}</div>${transfers.length ? `<form class="settlement-box" id="settlement-form"><p>Registre um pagamento feito entre as pessoas e atualize os saldos.</p><div class="settle-form"><select id="settlement-choice" aria-label="Acerto para registrar" required>${transferOptions}</select><button class="button primary small">Registrar</button></div></form>` : ''}</section></div>
    <section class="panel table-panel"><div class="panel-head"><div><h2>Despesas do grupo</h2><p>Quem pagou e quanto foi</p></div><button id="expense-shortcut" class="text-button">+ Adicionar despesa</button></div><div class="expense-list">${expenseRows}</div></section>
    ${settlementRows ? `<section class="panel" style="margin-top:14px"><div class="panel-head"><div><h2>Acertos registrados</h2><p>Pagamentos feitos entre participantes</p></div></div><div class="settlement-list">${settlementRows}</div></section>` : ''}`;
  $('#add-expense').onclick = () => renderExpenseForm(members);
  $('#expense-shortcut').onclick = () => renderExpenseForm(members);
  $('#add-member').onclick = () => renderMemberForm();
  const settlementForm = $('#settlement-form');
  if (settlementForm) settlementForm.onsubmit = async event => {
    event.preventDefault(); const [fromMember, toMember, amountCents] = $('#settlement-choice').value.split(':').map(Number);
    try { await api(`/api/groups/${activeGroupId}/settlements`, { method: 'POST', body: JSON.stringify({ fromMember, toMember, amountCents }) }); toast('Acerto registrado. Saldo atualizado!'); await loadSummary(); }
    catch (error) { toast(error.message); }
  };
}

function showInlineForm(html, onMount) {
  const overlay = document.createElement('div'); overlay.className = 'form-overlay'; overlay.innerHTML = html;
  overlay.addEventListener('click', event => { if (event.target === overlay || event.target.closest('[data-dismiss]')) overlay.remove(); });
  document.body.append(overlay); onMount(overlay);
}

function renderExpenseForm(members) {
  showInlineForm(`<form class="form-card"><button type="button" class="dialog-close" data-dismiss aria-label="Fechar">×</button><span class="eyebrow">NOVA DESPESA</span><h2>O que entrou na conta?</h2><p>Divida igualmente ou informe quanto cada pessoa consumiu.</p><label>Descrição</label><input name="description" maxlength="100" placeholder="Ex.: Mercado da viagem" required><label>Valor total (R$)</label><input name="amount" type="number" min="0.01" max="1000000" step="0.01" inputmode="decimal" placeholder="0,00" required><label>Quem pagou?</label><select name="paidBy" required>${members.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('')}</select><label>Como dividir?</label><select name="splitMode" id="split-mode"><option value="equal">Dividir igualmente</option><option value="custom">Valores personalizados</option></select><div id="share-fields" hidden>${members.map(m => `<label>${escapeHtml(m.name)} (R$)<input class="share-input" data-member="${m.id}" type="number" min="0" step="0.01" value="0.00" required></label>`).join('')}<small id="share-total" class="form-error" aria-live="polite"></small></div><p class="form-error" role="alert"></p><button class="button primary full">Salvar despesa <span>→</span></button></form>`, overlay => {
    overlay.querySelector('select').style.cssText = 'width:100%;padding:11px;border:1px solid #e4e5dc;border-radius:8px;background:#fff;font:12px DM Sans,sans-serif';
    const mode = overlay.querySelector('#split-mode'), fields = overlay.querySelector('#share-fields'), amountInput = overlay.querySelector('[name="amount"]'), shareInputs = [...overlay.querySelectorAll('.share-input')], totalLabel = overlay.querySelector('#share-total');
    const equalShares = () => { const cents = Math.round((Number(amountInput.value) || 0) * 100), each = Math.floor(cents / members.length), remainder = cents % members.length; shareInputs.forEach((input, index) => { input.value = ((each + (index < remainder ? 1 : 0)) / 100).toFixed(2); }); };
    const validateShares = () => { const total = shareInputs.reduce((sum, input) => sum + (Math.round((Number(input.value) || 0) * 100)), 0), expected = Math.round((Number(amountInput.value) || 0) * 100); totalLabel.textContent = `Total das parcelas: ${money(total)} · ${total === expected ? 'confere' : `faltam ${money(Math.abs(expected - total))}`}`; totalLabel.style.color = total === expected ? '#25845e' : '#b7604b'; return total === expected; };
    mode.onchange = () => { fields.hidden = mode.value !== 'custom'; if (mode.value === 'custom') { equalShares(); validateShares(); } };
    amountInput.oninput = () => { if (mode.value === 'custom') validateShares(); };
    shareInputs.forEach(input => input.oninput = validateShares);
    overlay.querySelector('form').onsubmit = async event => { event.preventDefault(); const form = new FormData(event.currentTarget); const error = overlay.querySelector('form > .form-error');
      if (mode.value === 'custom' && !validateShares()) { error.textContent = 'A soma das parcelas precisa ser igual ao valor total.'; return; }
      const payload = { description: form.get('description'), amount: Number(form.get('amount')), paidBy: Number(form.get('paidBy')) };
      if (mode.value === 'custom') payload.shares = shareInputs.map(input => ({ memberId: Number(input.dataset.member), amountCents: Math.round(Number(input.value) * 100) }));
      try { await api(`/api/groups/${activeGroupId}/expenses`, { method: 'POST', body: JSON.stringify(payload) }); overlay.remove(); toast('Despesa adicionada e rateio atualizado!'); await loadSummary(); }
      catch (exception) { error.textContent = exception.message; }
    };
  });
}

function renderMemberForm() {
  showInlineForm(`<form class="form-card"><button type="button" class="dialog-close" data-dismiss aria-label="Fechar">×</button><span class="eyebrow">MAIS UMA PESSOA</span><h2>Quem faltou no grupo?</h2><p>A pessoa entra nos próximos rateios do grupo.</p><label>Nome</label><input name="name" maxlength="50" placeholder="Nome da pessoa" required><p class="form-error" role="alert"></p><button class="button primary full">Adicionar pessoa <span>→</span></button></form>`, overlay => {
    overlay.querySelector('form').onsubmit = async event => { event.preventDefault(); const name = new FormData(event.currentTarget).get('name'); const error = overlay.querySelector('.form-error');
      try { await api(`/api/groups/${activeGroupId}/members`, { method: 'POST', body: JSON.stringify({ name }) }); overlay.remove(); toast('Pessoa adicionada! Ela participa dos próximos rateios.'); await loadGroups(activeGroupId); }
      catch (exception) { error.textContent = exception.message; }
    };
  });
}

function openDialog() { $('#dialog-error').textContent = ''; $('#group-form').reset(); $('#group-dialog').showModal(); }
$('#new-group-open').addEventListener('click', openDialog);
$('[data-close-dialog]').addEventListener('click', () => $('#group-dialog').close());
$('#group-list').addEventListener('click', event => { const button = event.target.closest('[data-group]'); if (button) loadGroups(Number(button.dataset.group)); });
$('#group-form').addEventListener('submit', async event => {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  const members = [...new Set(String(form.get('members')).split(',').map(name => name.trim()).filter(Boolean))];
  try { const group = await api('/api/groups', { method: 'POST', body: JSON.stringify({ name: form.get('name'), members }) }); $('#group-dialog').close(); toast('Grupo criado. Bora acertar as contas!'); await loadGroups(group.id); }
  catch (error) { $('#dialog-error').textContent = error.message; }
});

loadGroups().catch(error => { $('#content').innerHTML = `<div class="welcome"><h1>Opa, algo deu errado</h1><p>${escapeHtml(error.message)}</p></div>`; });
