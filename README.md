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
- Interface responsiva em português brasileiro, com tema claro/escuro (segue o sistema ou escolha manual).
- Instalável como app (PWA): manifest, ícones e service worker com shell offline.

## Executar localmente

Requer Node.js 20 ou superior.

```bash
npm install
npm start
```

Abra <http://localhost:3000>. Os dados ficam em `data/contajusta.sqlite`, que não é enviado ao Git.

### Variáveis de ambiente

Validadas no boot (valor inválido derruba o processo com mensagem clara). Modelo em `.env.example`.

| Variável                | Padrão                   | Descrição                                                      |
| ----------------------- | ------------------------ | -------------------------------------------------------------- |
| `PORT`                  | `3000`                   | Porta HTTP.                                                    |
| `DATABASE_PATH`         | `data/contajusta.sqlite` | Caminho do banco SQLite.                                       |
| `LOG_LEVEL`             | `info`                   | `debug`, `info`, `warn`, `error` ou `silent`.                  |
| `TRUST_PROXY`           | `0`                      | Saltos de proxy confiáveis; use `1` atrás de Fly/Render/Nginx. |
| `RATE_LIMIT_PER_MINUTE` | `60`                     | Escritas por IP por minuto na API; `0` desativa.               |
| `BACKUP_KEEP`           | `14`                     | Quantidade de backups mantidos por `npm run backup`.           |

### Scripts

```bash
npm run dev           # servidor com recarga automática
npm test              # testes de domínio, API, migração e do servidor real (node:test)
npm run lint          # ESLint
npm run format        # Prettier
npm run check         # lint + formatação + testes (o mesmo que roda no CI)
npm run backup        # backup online do SQLite com retenção
```

## Produção

### Docker

```bash
docker compose up --build    # http://localhost:3000, dados no volume contajusta-data
```

A imagem roda como usuário sem privilégios, guarda o banco em `/data` (volume) e tem `HEALTHCHECK` em `/api/health`.

### Fly.io

```bash
fly launch --no-deploy                       # usa o fly.toml do repositório
fly volumes create contajusta_data --size 1  # disco persistente do SQLite
fly deploy
```

SQLite exige **uma única instância** com volume. Para escalar horizontalmente, migre para PostgreSQL (o acesso a dados está isolado em `src/store.js`).

### Backups

`npm run backup` usa a API de backup online do SQLite: a cópia é consistente mesmo com o app no ar. Agende via cron (ou `fly machine run … --schedule daily`) e copie o diretório para um storage externo (S3, R2, Backblaze).

### Observabilidade

- Logs em JSON, uma linha por evento, com `requestId` (propaga `X-Request-Id` recebido ou gera um UUID, devolvido no cabeçalho da resposta).
- Chaves de grupo aparecem redigidas nos logs (`/g/dHhM…`), pois funcionam como credenciais.
- `GET /api/health` verifica o banco e retorna a versão em execução.

### CI/CD

Cada push e PR roda lint, formatação e testes em Node 20 e 22, constrói a imagem Docker e faz smoke test do container. O Dependabot abre PRs semanais de dependências npm e mensais de actions e imagem base.

## Estrutura

```
server.js            # ponto de entrada: config, logger, banco, HTTP e shutdown gracioso
src/
  app.js             # composição do Express
  db.js              # conexão SQLite e migrações versionadas (PRAGMA user_version)
  store.js           # acesso a dados (toda a SQL fica aqui)
  config.js          # variáveis de ambiente validadas
  logger.js          # logger JSON estruturado
  http/              # erros, segurança, request id/log de acesso, rate limit e validação
  routes/            # rotas por recurso: grupos, despesas e acertos
  domain/            # regras puras, sem I/O: dinheiro, divisão e acertos
public/              # frontend estático (HTML, CSS com tokens claro/escuro, JS sem framework, PWA)
scripts/backup.js    # backup online do SQLite
test/                # testes de domínio, API, migração, infra e servidor real
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

## Acesso e convites

Cada grupo recebe uma chave aleatória de 128 bits e fica em `/g/<chave>`. O botão **Convidar** copia ou compartilha esse link; ao abri-lo, o grupo é lembrado no dispositivo (localStorage). A API não lista grupos de terceiros e IDs sequenciais não são aceitos nas rotas.

## API

- `GET /api/health` — verificação de saúde (inclui acesso ao banco).
- `GET /api/groups?ids=chave1,chave2` — retorna apenas os grupos cujas chaves foram informadas (não há listagem global).
- `POST /api/groups` — cria grupo; corpo: `{ "name": "Viagem", "members": ["Ana", "Bia"] }`. A resposta traz `id`, a chave secreta do grupo.

Nas rotas abaixo, `:id` é essa chave (22 caracteres base64url), nunca um número sequencial.

- `POST /api/groups/:id/members` — adiciona uma pessoa.
- `GET /api/groups/:id/summary` — retorna despesas, saldos (com quanto cada pessoa pagou e consumiu), acertos e sugestões.
- `POST /api/groups/:id/expenses` — registra despesa; corpo: `{ "description": "Jantar", "amount": 120.50, "paidBy": 1, "split": … }`.
  - `split` é opcional (padrão: igual entre todos).
  - Igual entre parte do grupo: `{ "mode": "equal", "memberIds": [1, 2] }`.
  - Valores exatos: `{ "mode": "exact", "shares": [{ "memberId": 1, "amount": "70,00" }, { "memberId": 2, "amount": 50.5 }] }`.
  - Também aceita `shares: [{ "memberId": 1, "amountCents": 6000 }, ...]` na raiz do corpo, com uma parcela para cada pessoa do grupo.
- `GET /api/groups/:id/expenses/:expenseId` — detalhe da despesa com as parcelas.
- `PUT /api/groups/:id/expenses/:expenseId` — edita a despesa (mesmo corpo do `POST`).
- `DELETE /api/groups/:id/expenses/:expenseId` — exclui a despesa (exclusão lógica).
- `GET /api/groups/:id/expenses/:expenseId/history` — eventos de auditoria, inclusive após a exclusão.
- `POST /api/groups/:id/settlements` — registra um acerto; corpo: `{ "fromMember": 2, "toMember": 1, "amountCents": 3000 }`.
- `DELETE /api/groups/:id/settlements/:settlementId` — desfaz um acerto.

## Próximas melhorias

- Contas de usuário opcionais para sincronizar grupos entre dispositivos.
- Divisão por porcentagem ou por cotas.
- Deploy com banco PostgreSQL e backups.

## Limitações desta versão

Não há contas de usuário: quem tiver o link de um grupo pode ver e editar suas contas, como em links de documentos compartilhados. Não há integração com meios de pagamento.
