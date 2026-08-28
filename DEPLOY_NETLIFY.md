# Deploy no Netlify + MongoDB Atlas

Este projeto foi preparado para usar um único repositório GitHub:

```txt
GitHub
  ├── front-end JavaScript/HTML/CSS
  └── back-end Netlify Functions (Node.js)

Netlify
  ├── publica public/
  └── executa netlify/functions/

MongoDB Atlas
  └── salva as vagas e o estado da coleta
```

## 1. Criar o MongoDB Atlas

1. Acesse o MongoDB Atlas e crie um projeto.
2. Crie um cluster.
3. Em `Database Access`, crie um usuário de banco e uma senha forte.
4. Em `Network Access`, libere acesso para as Functions do Netlify. Como Functions serverless podem usar IPs variáveis, a configuração simples é `0.0.0.0/0`. Use credenciais fortes e exclusivas para este projeto.
5. Em `Connect` > `Drivers`, copie a connection string.

Exemplo:

```txt
mongodb+srv://USUARIO:SENHA@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
```

Não coloque essa URI dentro de nenhum arquivo que será enviado ao GitHub.

## 2. Subir o projeto no GitHub

Pode subir o front e o back juntos. O que não pode subir é a senha/URI do MongoDB.

Crie um repositório vazio no GitHub e, dentro da pasta do projeto, rode:

```bash
git init
git add -A
git commit -m "Adiciona LinkedIn Front-End Radar v26"
git branch -M main
git remote add origin URL_DO_SEU_REPOSITORIO
git push -u origin main
```

O repositório pode ser público ou privado. Se for privado, autorize o Netlify a acessá-lo quando fizer a integração com GitHub.

## 3. Criar o site no Netlify

1. Entre no Netlify.
2. Clique em `Add new project` / `Import an existing project`.
3. Escolha GitHub.
4. Escolha o repositório deste radar.
5. O `netlify.toml` já define:

```txt
Publish directory: public
Functions directory: netlify/functions
Node: 20
```

Não precisa configurar framework. O front é JavaScript puro e não possui build.

## 4. Configurar variáveis de ambiente

No Netlify, abra:

```txt
Site configuration
→ Environment variables
```

Crie:

```txt
MONGODB_URI = mongodb+srv://...
MONGODB_DB = linkedin_frontend_radar
LINKEDIN_LOCATION = Brazil
MAINTENANCE_RETENTION_DAYS = 90
MAINTENANCE_MAX_JOBS = 2000
```

`MONGODB_URI` é obrigatória.

Depois de criar as variáveis, faça um novo deploy.

## 5. Testar o banco

Com o deploy publicado, abra:

```txt
https://SEU-SITE.netlify.app/api/health
```

O resultado esperado é semelhante a:

```json
{
  "ok": true,
  "database": "linkedin_frontend_radar"
}
```

Se aparecer `MONGODB_URI não configurada`, confira as variáveis de ambiente e faça novo deploy.

## 6. Abrir o Radar

Abra:

```txt
https://SEU-SITE.netlify.app/
```

Se o banco ainda estiver vazio, `/api/jobs` inicia uma pequena coleta inicial. Você também pode clicar em `Atualizar agora`.

## 7. Coleta automática com o dashboard fechado

O arquivo `netlify.toml` contém:

```toml
[functions."scheduled-collect"]
  schedule = "*/5 * * * *"
```

Isso chama a função de coleta periodicamente no Netlify.

Portanto:

* pode fechar a aba;
* pode fechar o Chrome;
* pode finalizar o navegador pelo Gerenciador de Tarefas;
* pode desligar seu computador;
* pode abrir pelo celular depois.

As vagas que já chegaram ao MongoDB continuam salvas e a coleta não depende do seu navegador.

## 8. Sobre o favicon verde

O site usa dois favicons:

```txt
favicon.svg
favicon-new.svg
```

Quando existe pelo menos uma vaga com menos de uma hora, o JavaScript troca para `favicon-new.svg`, que contém a bolinha verde.

Quando nenhuma vaga carregada estiver abaixo de uma hora, ele volta automaticamente para o favicon normal.

`NOVO`, `≤ 1 HORA`, contorno verde e favicon verde usam a mesma regra de tempo.

## 9. Não indexar nos mecanismos de busca

O projeto contém três camadas:

1. `robots.txt` com `Disallow: /`;
2. `<meta name="robots" content="noindex,...">` no HTML;
3. `X-Robots-Tag: noindex...` em `public/_headers` e nas APIs.

Isso instrui mecanismos de busca a não indexarem o projeto.

Importante: `noindex` não é senha. Quem souber a URL ainda poderá abrir o site. Para bloquear acesso de verdade, use proteção por autenticação/senha.

## 10. Atualizações futuras

Quando eu te enviar uma nova versão:

1. substitua os arquivos do repositório;
2. commit/push;
3. o Netlify cria um novo deploy automaticamente.

Exemplo:

```bash
git add -A
git commit -m "Atualiza LinkedIn Front-End Radar"
git push origin main
```

Você não precisa recriar o banco. Enquanto continuar usando o mesmo `MONGODB_URI` e `MONGODB_DB`, as vagas persistem entre versões.


## 11. Manutenção do MongoDB

A v26 inclui manutenção manual e automática.

No dashboard, clique em:

```txt
Manutenção do banco
```

Esse botão chama `/api/maintenance` e executa uma política segura e fixa:

* remove vagas com mais de `MAINTENANCE_RETENTION_DAYS` dias (90 por padrão);
* mantém no máximo `MAINTENANCE_MAX_JOBS` vagas (2.000 por padrão);
* nunca apaga o estado do coletor;
* não apaga configurações do Netlify ou do MongoDB;
* retorna quantas vagas foram removidas e, quando disponível, o tamanho do Atlas antes/depois.

Além disso, `scheduled-maintenance` executa a mesma limpeza automaticamente todos os dias às 03:15 UTC.

Com os valores padrão, a coleção de vagas não cresce indefinidamente. Você pode clicar no botão quando quiser sem precisar entrar no painel do MongoDB Atlas.
