# Guia de configuração do app Euforia

Este guia coloca o app no ar, do zero, sem precisar programar.
Siga as etapas **na ordem**. Leva mais ou menos 30 a 40 minutos no total.

Você vai usar 3 serviços gratuitos:

- **Supabase**: guarda os dados na internet (o "banco de dados").
- **GitHub**: guarda o código do app (você já tem: `gabiru13773/doce_base`).
- **Vercel**: coloca o app no ar, com um endereço próprio.

> **Situação atual (out/2026):** as etapas 1 e 2 já foram feitas. O projeto
> `confeitaria-euforia` existe no Supabase (região São Paulo), com as tabelas
> dos módulos 0–2 criadas e protegidas. Endereço: `https://xmlmwjwdxvnwsueinfwc.supabase.co`.
> Falta: etapa 3 (criar o login e bloquear cadastros) e etapa 4 (Vercel).
> As próximas migrations também precisam ser rodadas nesse projeto.

> **Dica:** faça tudo pelo computador. No celular, só a etapa 5 (instalar o app).

> **Sobre os nomes dos menus:** esses sites mudam o visual de vez em quando.
> Se um botão estiver com nome um pouco diferente, procure algo parecido.

---

## 1. Criar o projeto no Supabase

### 1.1. Criar a conta

1. Acesse **https://supabase.com**.
2. Clique em **Start your project** (ou **Sign up**).
3. Entre com sua conta do **GitHub** (mais fácil) ou com e-mail e senha.

### 1.2. Criar o projeto

1. Clique em **New project**.
2. Se pedir uma "organização", crie uma com qualquer nome (ex.: `Euforia`) e escolha o plano **Free**.
3. Preencha:
   - **Name:** `euforia`
   - **Database Password:** clique em **Generate a password** e **guarde essa senha** em lugar seguro.
   - **Region:** escolha **South America (São Paulo)** — aparece também como `sa-east-1`.
4. Clique em **Create new project**.
5. Espere 1 a 2 minutos até o projeto ficar pronto.

### 1.3. Pegar o endereço e a chave pública

Você vai precisar de **2 informações**. Copie as duas para um bloco de notas.

1. No menu da esquerda, clique na **engrenagem** (**Project Settings**).
2. Procure a parte **API** ou **API Keys** (o nome pode variar um pouco).
3. Copie:
   - **Project URL** — algo como `https://abcdefgh.supabase.co`.
     (Às vezes ela fica em **Project Settings > Data API**, ou no botão **Connect** no topo.)
   - A chave pública. Ela pode aparecer de um destes jeitos:
     - **Publishable key** (começa com `sb_publishable_...`), **ou**
     - **anon public** (um texto longo que começa com `eyJ...`). Às vezes fica na aba **Legacy API keys**.

     Qualquer uma das duas serve.

> **Atenção:** NÃO use a chave **service_role** nem a **secret**.
> Essas são secretas e dão acesso total. O app só precisa da chave **pública**.

---

## 2. Criar as tabelas (rodar as "migrations")

As "migrations" são arquivos com instruções que criam as tabelas do app.
Eles ficam na pasta `supabase/migrations` do repositório no GitHub.

Hoje são estes (rode **nesta ordem**):

1. `0001_fundacao.sql`
2. `0002_insumos.sql`

Quando novos módulos ficarem prontos, vão aparecer outros (`0003_...`, `0004_...`).
Rode sempre **um de cada vez, em ordem de número**, e só os que você ainda não rodou.

### Como rodar cada arquivo

1. No GitHub, abra o repositório `gabiru13773/doce_base`.
2. Entre na pasta `supabase` e depois em `migrations`.
3. Clique no arquivo (comece pelo `0001_fundacao.sql`).
4. Clique no botão **Copy raw file** (ícone de duas folhinhas, no canto direito acima do texto).
5. No Supabase, no menu da esquerda, clique em **SQL Editor**.
6. Clique em **New query** (ou no **+**).
7. Cole o texto (Ctrl+V).
8. Clique em **Run** (ou aperte Ctrl+Enter).
9. Deve aparecer **Success. No rows returned**. Isso é bom!
10. Repita os passos 3 a 9 com o próximo arquivo (`0002_insumos.sql`).

> **Se aparecer um aviso** sobre "destructive operation" ou parecido, leia com calma.
> Nossos arquivos só criam coisas. Pode confirmar.

> **Se aparecer erro dizendo que algo "already exists" (já existe):**
> provavelmente esse arquivo já foi rodado antes. Pule para o próximo.

Para conferir: no menu da esquerda, clique em **Table Editor**.
Devem aparecer as tabelas `config_precificacao`, `insumos` e `precos_insumo`.

---

## 3. Segurança: só vocês dois entram

O app é **só para você e sua esposa**. Ninguém mais pode criar conta.

### 3.1. Bloquear novos cadastros

1. No menu da esquerda, clique em **Authentication**.
2. Clique em **Sign In / Providers** (o nome pode variar um pouco; pode estar dentro de **Configuration**).
3. Procure a opção **Allow new users to sign up**.
4. **Desligue** essa opção.
5. Clique em **Save** (se aparecer o botão).

> **Importante:** faça isso **antes** de divulgar o endereço do app.
> Com a opção desligada, só entra quem você mesmo cadastrar.

### 3.2. Criar os 2 usuários

Faça isto **duas vezes**: uma para você e outra para sua esposa.

1. Em **Authentication**, clique em **Users**.
2. Clique em **Add user** e depois em **Create new user**.
3. Preencha o **e-mail** e uma **senha**.
4. Deixe marcada a opção **Auto Confirm User** (assim não precisa confirmar e-mail).
5. Clique em **Create user**.

> **Guarde o e-mail e a senha de cada um.** É com eles que vocês vão entrar no app.

---

## 4. Colocar o app no ar (Vercel)

### 4.1. Criar a conta

1. Acesse **https://vercel.com**.
2. Clique em **Sign Up**.
3. Escolha o plano **Hobby** (gratuito).
4. Entre com **Continue with GitHub**.
5. Se o GitHub pedir permissão para a Vercel, clique em **Authorize** / **Install**.
   Você pode liberar todos os repositórios ou só o `doce_base`.

### 4.2. Importar o repositório

1. No painel da Vercel, clique em **Add New...** e depois em **Project**.
2. Na lista, encontre **doce_base** e clique em **Import**.
   (Se não aparecer, clique em **Adjust GitHub App Permissions** e libere o repositório.)
3. Em **Framework Preset**, confira se está **Vite**. Se não estiver, escolha **Vite**.
4. Não mexa em **Build Command** nem em **Output Directory**. O padrão já serve.

### 4.3. Colocar as chaves do Supabase

Ainda na mesma tela, abra a parte **Environment Variables**.
Adicione **duas** variáveis (nome à esquerda, valor à direita):

| Nome (Key)               | Valor (Value)                                    |
| ------------------------ | ------------------------------------------------ |
| `VITE_SUPABASE_URL`      | a **Project URL** que você copiou na etapa 1.3   |
| `VITE_SUPABASE_ANON_KEY` | a **chave pública** que você copiou na etapa 1.3 |

> **Atenção aos nomes:** copie exatamente como está acima, com letras maiúsculas e `_`.
> Não deixe espaço antes nem depois do valor.

### 4.4. Publicar

1. Clique em **Deploy**.
2. Espere 1 a 3 minutos.
3. Quando aparecer a tela de parabéns, clique em **Continue to Dashboard**.
4. O endereço do app aparece em **Domains** (algo como `doce-base.vercel.app`).
5. Abra o endereço. Deve aparecer a tela de **login**. Entre com um dos usuários da etapa 3.2.

> **Se aparecer o aviso "Modo local"** na tela inicial, as chaves não foram lidas.
> Veja "Problemas comuns", mais abaixo.

### 4.5. Atualizações são automáticas

Toda vez que uma mudança for enviada ao GitHub (na branch principal),
a Vercel **publica a nova versão sozinha**, em poucos minutos.
Você não precisa fazer nada.

> **Se você mudar uma variável depois** (etapa 4.3), a mudança só vale depois de publicar de novo:
> em **Deployments**, clique nos **três pontinhos** da publicação mais recente e em **Redeploy**.

---

## 5. Instalar no celular

Use o endereço do app da etapa 4.4. Faça isso nos dois celulares.

### Android (Google Chrome)

1. Abra o endereço do app no **Chrome**.
2. Toque nos **três pontinhos** (canto de cima, à direita).
3. Toque em **Instalar app** ou **Adicionar à tela inicial**.
4. Confirme. O ícone da Euforia vai aparecer junto com os outros apps.

### iPhone (Safari)

> No iPhone, use o **Safari**. Pelo Chrome do iPhone pode não funcionar igual.

1. Abra o endereço do app no **Safari**.
2. Toque no botão **Compartilhar** (o quadradinho com uma seta para cima).
3. Role a lista e toque em **Adicionar à Tela de Início**.
4. Toque em **Adicionar**.

Depois de instalado, abra sempre pelo **ícone**. O app abre em tela cheia, como um app normal.

---

## 6. Trocar a logo e as cores

A logo e as cores atuais são **provisórias**.

### O jeito mais fácil

**Envie a logo oficial no chat para o Claude** (de preferência em SVG ou PNG grande, com fundo transparente).
Ele troca a logo, gera os ícones do celular e ajusta as cores do app para combinar.

### Se quiser fazer por conta própria

- **Logo:** os arquivos ficam em `public/` (`logo-completa.webp`, `logo-nome.webp`, `logo-simbolo.png` e os ícones `icon-*.png`).
  Os ícones do celular são os arquivos `public/icon-192.png`, `public/icon-512.png` e
  `public/apple-touch-icon.png`. Eles também precisam ser refeitos com a nova logo.
- **Cores:** ficam no arquivo `src/styles/theme.css`, no começo, em linhas como
  `--color-marca: #b83a6b;`. Troque o código da cor (o que vem depois do `#`).
  A cor da barra do celular fica em `vite.config.ts` e `index.html` (`theme_color` / `theme-color`).

> Depois de trocar, o celular pode demorar para mostrar o ícone novo.
> Às vezes é preciso remover o app da tela inicial e instalar de novo.

---

## 7. Problemas comuns

### "Não consigo entrar"

- Confira se o **e-mail** está certo, sem espaço no fim.
- A senha diferencia **maiúsculas e minúsculas**.
- No Supabase, em **Authentication > Users**, veja se o usuário existe.
- Se o usuário aparece como "não confirmado" (**Waiting for verification**), apague-o e crie de novo
  com **Auto Confirm User** marcado (etapa 3.2).
- Esqueceu a senha? Em **Authentication > Users**, clique no usuário e procure a opção
  de trocar a senha (o nome pode variar um pouco). Se não achar, apague o usuário e crie de novo.
  Os dados do app **não** se perdem ao apagar um usuário.

### "Os dados não aparecem no outro celular"

- Veja se aparece o aviso **"Modo local"** na tela inicial de algum dos celulares.
  Se aparecer, os dados estão ficando **só naquele aparelho**. Causas comuns:
  - As variáveis da Vercel estão com nome errado ou faltando (etapa 4.3).
  - As variáveis foram colocadas **depois** da publicação e não houve **Redeploy** (etapa 4.5).
- Confirme que os dois celulares usam o **mesmo endereço** do app.
- Feche o app e abra de novo, para ele buscar os dados mais recentes.
- **Atenção:** o que foi cadastrado em "Modo local" **não vai sozinho** para a nuvem.

### "O app não atualizou"

- **Feche o app de vez** (tire da lista de apps abertos) e **abra de novo**.
  Às vezes é preciso fazer isso duas vezes.
- Na Vercel, em **Deployments**, veja se a última publicação está como **Ready**.
  Se estiver **Error**, avise o Claude e mande um print da tela.

### "O app parou de funcionar depois de dias sem usar"

- No plano gratuito, o Supabase **pausa** o projeto depois de um tempo sem uso (cerca de 1 semana).
- Entre em **https://supabase.com**, abra o projeto e clique em **Restore project** (ou **Resume**).
- Espere alguns minutos e abra o app de novo. Os dados continuam lá.
