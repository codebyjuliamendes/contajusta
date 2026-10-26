# ContaJusta

Aplicação full stack para dividir despesas de grupos com transparência. Crie um grupo, registre despesas pagas por qualquer participante e veja os saldos e os acertos sugeridos automaticamente.

## Funcionalidades

- Criação de grupos com 2 a 20 participantes e adição posterior de pessoas.
- Registro de despesas com divisão igual (entre todos ou só parte do grupo) ou por valores exatos por pessoa.
- Edição e exclusão de despesas com histórico de auditoria (criação, edições e exclusão).
- Cálculo de quanto cada pessoa pagou, deve ou tem a receber.
- Sugestão de transferências para quitar os saldos com menos acertos.
- Registro de pagamentos feitos e atualização dos saldos, com opção de desfazer um acerto.
- Banco SQLite local criado automaticamente na primeira execução.
- Interface responsiva em português brasileiro.

## Executar localmente

Requer Node.js 20 ou superior.

```bash
npm install
npm start
```

Abra <http://localhost:3000>. Os dados ficam em `data/contajusta.sqlite`, que não é enviado ao Git.

### Variáveis de ambiente

| Variável        | Padrão                   | Descrição                                         |
| --------------- | ------------------------ | ------------------------------------------------- |
| `PORT`          | `3000`                   | Porta HTTP.                                       |
| `DATABASE_PATH` | `data/contajusta.sqlite` | Caminho do banco SQLite (`:memory:` para testes). |

### Scripts

```bash
npm run dev           # servidor com recarga automática
npm test              # testes unitários e de API (node:test)
npm run lint          # ESLint
npm run format        # Prettier
npm run check         # lint + formatação + testes (o mesmo que roda no CI)
```

## Estrutura

```
server.js            # ponto de entrada: abre o banco, sobe o HTTP e faz shutdown gracioso
src/
  app.js             # composição do Express
  db.js              # conexão SQLite e migrações versionadas (PRAGMA user_version)
  store.js           # acesso a dados (toda a SQL fica aqui)
  http/              # erros, headers de segurança e validação/normalização de entrada
  routes/            # rotas por recurso: grupos, despesas e acertos
  domain/            # regras puras, sem I/O: dinheiro, divisão e acertos
public/              # frontend estático (HTML, CSS e JS sem framework)
test/                # testes de domínio e de integração da API
```

## Stack

- Node.js e Express 5 para a API REST.
- SQLite com `better-sqlite3` para persistência local.
- HTML, CSS e JavaScript sem framework no frontend.

## Decisões técnicas

- Valores são convertidos para centavos inteiros antes de serem persistidos, a partir do texto do número (sem multiplicar floats). Aceita `120.5`, `"120,50"` e `"1.234,56"`; valores com mais de duas casas decimais são rejeitados.
- Divisão igual: o centavo restante vai para as primeiras pessoas (ordem do grupo). Divisão exata: a soma das partes precisa ser igual ao total. Em ambos os casos a soma das parcelas é sempre o valor original.
- Exclusões são lógicas (`deleted_at`): despesas e acertos excluídos saem dos saldos, mas permanecem no banco. Cada criação, edição e exclusão de despesa grava um snapshot JSON em `expense_events`.
- Criação do grupo e gravação das parcelas de uma despesa usam transações SQLite, para não deixar dados parcialmente gravados.
- Uma pessoa adicionada depois de uma despesa participa apenas de despesas futuras.
- As sugestões de acerto são calculadas a partir dos saldos líquidos, casando sempre o maior devedor com o maior credor (no máximo n − 1 transferências). O sistema não inicia transferências bancárias.
- O esquema do banco evolui por migrações numeradas em `src/db.js`; bancos criados pela versão anterior são atualizados automaticamente.
- A API responde erros sempre em JSON (inclusive JSON malformado) e envia cabeçalhos de segurança, incluindo Content-Security-Policy sem `unsafe-inline`.

## API

- `GET /api/health` — verificação de saúde (inclui acesso ao banco).
- `GET /api/groups` — lista grupos e participantes.
- `POST /api/groups` — cria grupo; corpo: `{ "name": "Viagem", "members": ["Ana", "Bia"] }`.
- `POST /api/groups/:id/members` — adiciona uma pessoa.
- `GET /api/groups/:id/summary` — retorna despesas, saldos (com quanto cada pessoa pagou e consumiu), acertos e sugestões.
- `POST /api/groups/:id/expenses` — registra despesa; corpo: `{ "description": "Jantar", "amount": 120.50, "paidBy": 1, "split": … }`.
  - `split` é opcional (padrão: igual entre todos).
  - Igual entre parte do grupo: `{ "mode": "equal", "memberIds": [1, 2] }`.
  - Valores exatos: `{ "mode": "exact", "shares": [{ "memberId": 1, "amount": "70,00" }, { "memberId": 2, "amount": 50.5 }] }`.
- `GET /api/groups/:id/expenses/:expenseId` — detalhe da despesa com as parcelas.
- `PUT /api/groups/:id/expenses/:expenseId` — edita a despesa (mesmo corpo do `POST`).
- `DELETE /api/groups/:id/expenses/:expenseId` — exclui a despesa (exclusão lógica).
- `GET /api/groups/:id/expenses/:expenseId/history` — eventos de auditoria, inclusive após a exclusão.
- `POST /api/groups/:id/settlements` — registra um acerto; corpo: `{ "fromMember": 2, "toMember": 1, "amountCents": 3000 }`.
- `DELETE /api/groups/:id/settlements/:settlementId` — desfaz um acerto.

## Próximas melhorias

- Contas de usuário e convite por link.
- Divisão por porcentagem ou por cotas.
- Deploy com banco PostgreSQL e backups.

## Limitações desta versão

Esta primeira versão é uma demonstração local: não possui autenticação, convite remoto nem integração com meios de pagamento. Não insira dados pessoais ou financeiros reais.
