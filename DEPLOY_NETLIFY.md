# Deploy no Netlify + MongoDB Atlas

Este arquivo documenta a infraestrutura necessária para publicar o LinkedIn Front-End Radar. Ele é separado do README para manter a apresentação do projeto mais objetiva e deixar o processo de deploy reproduzível.

## Arquitetura de deploy

```txt
GitHub
  ├── front-end HTML/CSS/JavaScript
  └── back-end Netlify Functions / Node.js

Netlify
  ├── publica public/
  └── executa netlify/functions/

MongoDB Atlas
  └── persiste vagas e estado do coletor
```

## 1. MongoDB Atlas

Crie um cluster e um usuário de banco. Em `Network Access`, permita a conexão das Netlify Functions.

Depois copie a connection string em `Connect` → `Drivers`.

Exemplo:

```txt
mongodb+srv://USUARIO:SENHA@cluster.mongodb.net/?retryWrites=true&w=majority
```

A URI não deve ser commitada no GitHub.

## 2. Netlify

Importe o repositório GitHub no Netlify.

O projeto já possui `netlify.toml` com:

```txt
Publish directory: public
Functions directory: netlify/functions
Node: 20
```

Não existe etapa de build do front-end.

## 3. Variáveis de ambiente

Configure no Netlify:

```txt
MONGODB_URI = mongodb+srv://...
MONGODB_DB = linkedin_frontend_radar
LINKEDIN_LOCATION = Brazil
MAINTENANCE_RETENTION_DAYS = 90
MAINTENANCE_MAX_JOBS = 2000
```

`MONGODB_URI` é obrigatória. Para Web Push não é necessário configurar chaves manualmente: o back-end gera o par VAPID automaticamente no primeiro uso e o persiste no MongoDB Atlas. A chave privada não é enviada ao navegador nem versionada no repositório.

## 4. Validar o deploy

Após publicar, teste:

```txt
https://SEU-SITE.netlify.app/api/health
```

Resposta esperada:

```json
{
  "ok": true,
  "database": "linkedin_frontend_radar"
}
```

Depois abra:

```txt
https://SEU-SITE.netlify.app/
```

## 5. Coleta automática

O `netlify.toml` agenda:

```toml
[functions."scheduled-collect"]
  schedule = "*/5 * * * *"
```

A coleta continua funcionando mesmo com o navegador fechado ou o computador desligado.

A busca histórica usa `LINKEDIN_LOCATION=Brazil` e não aplica filtro de período. O monitor de vagas recentes usa uma janela de 24 horas.

## 6. Retenção automática

O projeto executa manutenção diária pelo `scheduled-maintenance`.

Por padrão:

```txt
MAINTENANCE_RETENTION_DAYS = 90
MAINTENANCE_MAX_JOBS = 2000
```

A manutenção remove vagas fora da retenção e mantém somente as vagas mais recentes quando o limite máximo é ultrapassado.

Não há botão de manutenção no dashboard.

## 7. Favicon de vagas recentes

O dashboard utiliza:

```txt
favicon.ico
favicon-new.ico
```

Quando existe uma vaga com menos de uma hora, o JavaScript troca para o favicon com indicador verde. `NOVO`, `≤ 1 HORA`, contorno verde e favicon usam a mesma regra de tempo.

## 8. Web Push e PWA

O front-end registra `public/sw.js`, usa `PushManager` para criar a assinatura e grava a assinatura no MongoDB por `/api/push/subscribe`.

Quando o monitor encontra uma vaga realmente nova com menos de uma hora, o back-end envia uma notificação usando VAPID. O clique na notificação abre diretamente a vaga no LinkedIn.

No Android e em navegadores desktop compatíveis, basta permitir notificações. No iPhone/iPad, adicione o site à Tela de Início e abra o radar pelo ícone instalado antes de ativar as notificações.

O projeto inclui `manifest.webmanifest` e ícones de PWA para permitir a instalação no celular.

## 9. Não indexação

O projeto utiliza:

* `robots.txt` com `Disallow: /`;
* meta tag `robots` com `noindex`;
* `X-Robots-Tag` nos headers e APIs.

Isso reduz a indexação por mecanismos de busca, mas não substitui autenticação.

## 10. Atualizações

Depois do primeiro deploy, novas versões normalmente exigem apenas:

```bash
git add -A
git commit -m "Atualiza LinkedIn Front-End Radar"
git push origin main
```

O Netlify cria um novo deploy automaticamente. O banco continua sendo o mesmo enquanto `MONGODB_URI` e `MONGODB_DB` não forem alterados.
