# ContaJusta

Aplicação full stack para dividir despesas de grupos com transparência. Crie um grupo, registre despesas pagas por qualquer participante e veja os saldos e os acertos sugeridos automaticamente.

## Funcionalidades

- Criação de grupos com 2 a 20 participantes e adição posterior de pessoas.
- Registro de despesas com rateio igualitário ou personalizado por pessoa, usando valores inteiros em centavos.
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

## Stack

- Node.js e Express 5 para a API REST.
- SQLite com `better-sqlite3` para persistência local.
- HTML, CSS e JavaScript sem framework no frontend.

## Decisões técnicas

- Valores são convertidos para centavos inteiros antes de serem persistidos. Isso evita erros de ponto flutuante ao dividir dinheiro.
- Se a divisão não resultar em centavos inteiros iguais, o centavo restante é distribuído entre as primeiras pessoas do grupo. A soma das parcelas sempre corresponde ao valor original.
- Criação do grupo e gravação das parcelas de uma despesa usam transações SQLite, para não deixar dados parcialmente gravados.
- Rateios personalizados precisam incluir cada participante uma única vez e fechar exatamente com o valor total; a validação também ocorre no servidor.
- Uma pessoa adicionada depois de uma despesa participa apenas de despesas futuras.
- As sugestões de acerto são calculadas a partir dos saldos líquidos. O sistema não inicia transferências bancárias.

## API

- `GET /api/groups` — lista grupos e participantes.
- `POST /api/groups` — cria grupo; corpo: `{ "name": "Viagem", "members": ["Ana", "Bia"] }`.
- `POST /api/groups/:id/members` — adiciona uma pessoa.
- `GET /api/groups/:id/summary` — retorna despesas, saldos, acertos e sugestões.
- `POST /api/groups/:id/expenses` — registra despesa; corpo: `{ "description": "Jantar", "amount": 120.50, "paidBy": 1 }`.
- `POST /api/groups/:id/expenses` também aceita `shares: [{ "memberId": 1, "amountCents": 6000 }, ...]` para parcelas personalizadas.
- `POST /api/groups/:id/settlements` — registra um acerto entre participantes.

## Próximas melhorias

- Contas de usuário e convite por link.
- Rateio personalizado por pessoa.
- Edição e exclusão auditável de despesas.
- Deploy com banco PostgreSQL e backups.

## Limitações desta versão

Esta primeira versão é uma demonstração local: não possui autenticação, convite remoto nem integração com meios de pagamento. Não insira dados pessoais ou financeiros reais.
