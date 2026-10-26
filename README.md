# ContaJusta

Aplicação full stack para dividir despesas de grupos com transparência. Crie um grupo, registre despesas pagas por qualquer participante e veja os saldos e os acertos sugeridos automaticamente.

## Funcionalidades

- Criação de grupos com 2 a 20 participantes e adição posterior de pessoas.
- Registro de despesas e divisão igualitária com valores monetários guardados em centavos.
- Cálculo de quanto cada pessoa pagou, deve ou tem a receber.
- Sugestão de transferências para quitar os saldos com menos acertos.
- Registro de pagamentos feitos e atualização dos saldos.
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
  app.js             # fábrica do Express: rotas, validação, headers de segurança e erros
  db.js              # conexão SQLite e migrações versionadas (PRAGMA user_version)
  store.js           # acesso a dados (toda a SQL fica aqui)
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
- Se a divisão não resultar em centavos inteiros iguais, o centavo restante é distribuído entre as primeiras pessoas do grupo. A soma das parcelas sempre corresponde ao valor original.
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
- `POST /api/groups/:id/expenses` — registra despesa; corpo: `{ "description": "Jantar", "amount": 120.50, "paidBy": 1 }`.
- `POST /api/groups/:id/settlements` — registra um acerto; corpo: `{ "fromMember": 2, "toMember": 1, "amountCents": 3000 }`.

## Próximas melhorias

- Contas de usuário e convite por link.
- Rateio personalizado por pessoa.
- Edição e exclusão auditável de despesas.
- Deploy com banco PostgreSQL e backups.

## Limitações desta versão

Esta primeira versão é uma demonstração local: não possui autenticação, convite remoto nem integração com meios de pagamento. Não insira dados pessoais ou financeiros reais.
