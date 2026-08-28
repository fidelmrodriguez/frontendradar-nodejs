# LinkedIn Front-End Radar

Radar web de vagas Front-End no Brasil, desenvolvido com JavaScript, HTML, CSS e Node.js. A aplicação coleta vagas públicas do LinkedIn em background, persiste os dados no MongoDB Atlas e disponibiliza o histórico em um dashboard responsivo hospedado no Netlify.

## Demo

https://frontendradar-nodejs.netlify.app/

## Objetivo

Centralizar vagas Front-End do Brasil em uma única interface, priorizando vagas recentes e mantendo o histórico disponível independentemente do navegador ou dispositivo utilizado.

## Principais recursos

* Dashboard responsivo em JavaScript puro, sem framework de front-end.
* Coleta automática em background com Netlify Functions.
* Persistência compartilhada no MongoDB Atlas.
* Busca em múltiplas consultas Front-End com localização `Brazil`.
* Histórico coletado incrementalmente, sem filtro de período na busca histórica.
* Ordenação da vaga mais recente para a mais antiga.
* Deduplicação somente pelo ID da vaga no LinkedIn.
* Filtro local por cargo, empresa ou localização.
* Filtro de período no dashboard.
* Destaque visual para vagas com menos de uma hora (`NOVO` e `≤ 1 HORA`).
* Favicon dinâmico para sinalizar a existência de vagas recentes.
* Atualização manual sob demanda.
* Tratamento de rate limit (`HTTP 429`) com backoff automático.
* Coleta concorrente protegida por lock no MongoDB.
* Política automática de retenção para controlar o crescimento da base.
* Bloqueio de indexação por mecanismos de busca.

## Stack

* JavaScript
* HTML
* CSS
* Node.js 20
* Netlify Functions
* MongoDB Atlas
* Cheerio
* Node.js Test Runner

## Arquitetura

```txt
LinkedIn - endpoint público de vagas
              │
              ▼
     Netlify Functions / Node.js
              │
      ┌───────┴────────┐
      │                │
      ▼                ▼
 coleta agendada   coleta manual
      │                │
      └───────┬────────┘
              ▼
         MongoDB Atlas
              │
              ▼
           /api/jobs
              │
              ▼
      Dashboard HTML/CSS/JS
```

O navegador é responsável apenas pela apresentação, filtros e atualização visual. A coleta e a persistência ficam no back-end serverless e no MongoDB Atlas.

## Estrutura do projeto

```txt
linkedinfrontendradar-nodejs/
├── public/
│   ├── assets/
│   │   ├── css/styles.css
│   │   └── js/main.js
│   ├── _headers
│   ├── favicon.ico
│   ├── favicon-new.ico
│   ├── favicon.svg
│   ├── favicon-new.svg
│   ├── index.html
│   └── robots.txt
├── netlify/
│   └── functions/
│       ├── _lib/
│       │   ├── collector.mjs
│       │   ├── db.mjs
│       │   ├── linkedin.mjs
│       │   └── maintenance.mjs
│       ├── collect-now.mjs
│       ├── health.mjs
│       ├── jobs.mjs
│       ├── maintenance.mjs
│       ├── scheduled-collect.mjs
│       └── scheduled-maintenance.mjs
├── tests/
│   └── linkedin.test.mjs
├── netlify.toml
├── package.json
├── DEPLOY_NETLIFY.md
└── README.md
```

## Como a coleta funciona

A aplicação utiliza o endpoint público de busca de vagas do LinkedIn e executa múltiplas consultas relacionadas a Front-End, como `frontend`, `front end`, `react frontend`, `angular frontend`, `vue frontend` e `next.js frontend`.

O histórico é percorrido de forma incremental e o coletor mantém seu progresso no MongoDB. As vagas são normalizadas e filtradas antes da persistência. IDs diferentes continuam sendo tratados como vagas diferentes, mesmo quando título e empresa coincidem.

O `scheduled-collect` roda a cada 5 minutos no Netlify. Em caso de `429`, o coletor entra em backoff e retoma automaticamente.

## Persistência e retenção

As vagas ficam armazenadas no MongoDB Atlas, portanto o histórico continua disponível ao abrir o site em outro computador, celular ou navegador.

A política padrão mantém vagas de até 90 dias e limita a coleção às 2.000 vagas mais recentes. Esses valores podem ser alterados pelas variáveis de ambiente `MAINTENANCE_RETENTION_DAYS` e `MAINTENANCE_MAX_JOBS`.

## Executar localmente

```bash
git clone https://github.com/fidelmrodriguez/linkedinfrontendradar-nodejs.git
cd linkedinfrontendradar-nodejs
npm install
npm run dev
```

Configure as variáveis de ambiente necessárias antes de iniciar o projeto localmente.

## Scripts

```bash
npm run dev   # executa o site e as Netlify Functions localmente
npm test      # executa os testes
npm run check # executa a validação do projeto
```

## Deploy

O guia de infraestrutura e publicação está em [`DEPLOY_NETLIFY.md`](./DEPLOY_NETLIFY.md).

## Observações técnicas

* Front-end e back-end ficam no mesmo repositório.
* O MongoDB Atlas é a fonte persistente de dados.
* O coletor não depende do dashboard aberto.
* O histórico da coleta é retomado a partir do estado salvo no banco.
* O site solicita `noindex` por `robots.txt`, meta tags e `X-Robots-Tag`.
* `MONGODB_URI` deve ser configurada como variável de ambiente e nunca versionada no repositório.
