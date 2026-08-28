# LinkedIn Front-End Radar

LinkedIn Front-End Radar é um radar de vagas Front-End construído com JavaScript puro, HTML e CSS, com persistência no MongoDB Atlas e coleta automática por Netlify Functions.

## Netlify

https://frontendradar-nodejs.netlify.app/

## Recursos

* Dashboard web sem SPA e sem framework de front-end.
* Vagas salvas no MongoDB e compartilhadas entre computador, celular e qualquer outro navegador.
* Coleta automática em background pelo Netlify, sem depender do dashboard aberto.
* Busca pública de vagas do LinkedIn, sem usar login, cookie ou conta Premium.
* Histórico carregado aos poucos e monitoramento de vagas recentes.
* Ordenação das vagas da mais recente para a mais antiga.
* IDs diferentes são exibidos separadamente mesmo quando título, empresa e local são iguais.
* Filtro local por cargo, empresa ou localização.
* Filtro de período.
* Tags `NOVO` e `≤ 1 HORA` na mesma linha do título.
* Contorno verde enquanto a vaga tiver menos de uma hora.
* Favicon com bolinha verde enquanto existir ao menos uma vaga com menos de uma hora.
* Botão para atualização manual.
* Botão `Manutenção do banco`: remove vagas com mais de 90 dias e mantém no máximo as 2.000 mais recentes.
* Manutenção automática diária no Netlify como proteção adicional contra crescimento indefinido do MongoDB.
* Tratamento de `429` com pausa automática.
* Sem remoção de vagas, sem log de removidas e sem restauração.
* Bloqueio de indexação por `robots.txt`, meta tags e `X-Robots-Tag`.
* Layout responsivo para desktop e celular.

## Stack

* JavaScript
* HTML
* CSS
* Node.js 20
* Netlify Functions
* MongoDB Atlas
* Cheerio

## Arquitetura

```txt
linkedin-frontend-radar-javascript/
├── public/
│   ├── assets/
│   │   ├── css/styles.css
│   │   └── js/main.js
│   ├── _headers
│   ├── favicon.svg
│   ├── favicon-new.svg
│   ├── index.html
│   └── robots.txt
├── netlify/
│   └── functions/
│       ├── _lib/
│       │   ├── collector.mjs
│       │   ├── db.mjs
│       │   └── linkedin.mjs
│       ├── collect-now.mjs
│       ├── health.mjs
│       ├── jobs.mjs
│       ├── maintenance.mjs
│       ├── scheduled-maintenance.mjs
│       └── scheduled-collect.mjs
├── tests/
│   └── linkedin.test.mjs
├── .env.example
├── .gitignore
├── DEPLOY_NETLIFY.md
├── netlify.toml
├── package.json
└── README.md
```

O navegador só exibe e filtra os dados. A coleta e a persistência ficam no back-end das Netlify Functions e no MongoDB Atlas.

## Requisitos

* Node.js 20 ou superior.
* npm 10 ou superior.
* Conta no GitHub.
* Conta no Netlify.
* Cluster no MongoDB Atlas.

## Como clonar e rodar

```bash
git clone <url-do-repositorio>
cd linkedin-frontend-radar-javascript
npm install
```

Crie um `.env` usando `.env.example` como base e execute:

```bash
npm run dev
```

O Netlify CLI informa a URL local no terminal.

## Scripts disponíveis

```bash
npm run dev   # executa site + Netlify Functions localmente
npm test      # executa os testes
npm run check # executa a validação do projeto
```

## Deploy

O passo a passo completo está em `DEPLOY_NETLIFY.md`.

## Observações técnicas

* Front-end e back-end podem ficar no mesmo repositório GitHub. O código das Functions pode ser versionado normalmente.
* `MONGODB_URI` nunca deve ser commitada. Ela fica nas variáveis de ambiente do Netlify.
* O banco não fica dentro do Netlify ou do GitHub: ele fica no MongoDB Atlas.
* O Netlify executa `scheduled-collect` a cada 5 minutos, então o radar continua coletando mesmo com todos os seus navegadores fechados.
* A manutenção automática roda diariamente e o mesmo processo pode ser executado manualmente com um único clique no dashboard.
* Por padrão, o banco guarda no máximo 2.000 vagas e descarta vagas com mais de 90 dias. Os limites podem ser alterados pelas variáveis `MAINTENANCE_RETENTION_DAYS` e `MAINTENANCE_MAX_JOBS`.
* Fechar navegador, finalizar processo ou desligar o computador não apaga vagas já gravadas no MongoDB.
* A deduplicação é somente por ID do LinkedIn. Título/empresa iguais com IDs diferentes continuam aparecendo.
* O site pede aos mecanismos de busca para não indexarem nenhuma página. Isso reduz fortemente a indexação, mas não funciona como autenticação. Se a URL precisar ser realmente privada, use proteção de acesso adicional.
