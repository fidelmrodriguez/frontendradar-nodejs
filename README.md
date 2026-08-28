# LinkedIn Front-End Radar

Radar web de vagas Front-End no Brasil, desenvolvido com JavaScript, HTML, CSS e Node.js. A aplicação coleta vagas públicas do LinkedIn em background, persiste os dados no MongoDB Atlas e disponibiliza o histórico em um dashboard responsivo hospedado no Netlify.

## Netlify

https://frontendradar-nodejs.netlify.app/

## Recursos

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
* Indicador de ritmo médio recente (`1 vaga / X`), recalculado dinamicamente com as vagas carregadas dos últimos 30 dias.
* Favicon dinâmico para sinalizar a existência de vagas recentes.
* Notificações Web Push para novas vagas, com Service Worker e suporte a desktop e dispositivos móveis compatíveis.
* PWA instalável, permitindo uma experiência mais próxima de um aplicativo no celular.
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
* Web Push / VAPID
* Service Workers / PWA
* Node.js Test Runner

## Arquitetura

```txt
LinkedIn - endpoint público de vagas
              │
              ▼
     Netlify Functions / Node.js
              │
      ┌───────┴───────────────┐
      │                       │
      ▼                       ▼
 coleta agendada         coleta manual
      │                       │
      └──────────┬────────────┘
                 ▼
            MongoDB Atlas
                 │
        ┌────────┴─────────┐
        │                  │
        ▼                  ▼
     /api/jobs         Web Push / VAPID
        │                  │
        ▼                  ▼
 Dashboard HTML/CSS/JS   Service Worker
                           │
                           ▼
                 Notificação do sistema
```

O navegador é responsável apenas pela apresentação, filtros e atualização visual. A coleta e a persistência ficam no back-end serverless e no MongoDB Atlas.

## Estrutura do projeto

```txt
linkedinfrontendradar-nodejs/
├── public/
│   ├── assets/
│   │   ├── css/styles.css
│   │   └── js/
│   │       ├── main.js
│   │       └── push.js
│   ├── _headers
│   ├── favicon.ico
│   ├── favicon-new.ico
│   ├── favicon.svg
│   ├── favicon-new.svg
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── apple-touch-icon.png
│   ├── manifest.webmanifest
│   ├── sw.js
│   ├── index.html
│   └── robots.txt
├── netlify/
│   └── functions/
│       ├── _lib/
│       │   ├── collector.mjs
│       │   ├── db.mjs
│       │   ├── linkedin.mjs
│       │   ├── maintenance.mjs
│       │   └── push.mjs
│       ├── collect-now.mjs
│       ├── health.mjs
│       ├── jobs.mjs
│       ├── maintenance.mjs
│       ├── push-public-key.mjs
│       ├── push-subscribe.mjs
│       ├── push-unsubscribe.mjs
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

O dashboard também calcula, em tempo real, o ritmo médio recente de publicação das vagas carregadas nos últimos 30 dias. O indicador aparece junto aos status no formato `1 vaga / X` e é apenas uma estimativa baseada nos dados já coletados pelo radar.

## Notificações Web Push

O botão `Ativar notificações` registra um Service Worker e solicita a permissão nativa do navegador. A assinatura Web Push é armazenada no MongoDB Atlas e o coletor envia uma notificação na primeira vez que o monitor identifica uma vaga ainda não processada para push e com menos de uma hora.

A notificação é entregue pelo sistema operacional mesmo quando a aba do radar não está em primeiro plano. Ao clicar, a vaga correspondente é aberta no LinkedIn. Assinaturas expiradas são removidas automaticamente do banco.

No Android e em navegadores desktop compatíveis, o Web Push funciona diretamente após a permissão. Em iPhone e iPad, o radar deve ser adicionado à Tela de Início e aberto como web app para receber Web Push.

A chave VAPID privada nunca fica no front-end ou no repositório. No primeiro uso, o back-end gera automaticamente um par VAPID e o mantém no MongoDB Atlas na configuração interna da aplicação. Assim, depois de o MongoDB já estar configurado, não é necessário cadastrar chaves Web Push manualmente no Netlify.

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
