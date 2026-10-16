# Euforia Confeitaria

App interno da **Confeitaria Euforia**, feito para o celular.
Ajuda a controlar receitas, custos, preços, produção, estoque, pedidos e o financeiro do negócio.
Funciona como um app instalado (PWA) e guarda os dados na nuvem, sincronizados entre os aparelhos.

**Para colocar o app no ar e instalar no celular, siga o guia: [docs/CONFIGURACAO.md](docs/CONFIGURACAO.md).**

## Áreas e módulos

### Produção

| Módulo | O que faz                                                    | Status       |
| ------ | ------------------------------------------------------------ | ------------ |
| M0     | Fundação: login, layout, configurações de precificação       | ✅ Pronto    |
| M1     | Insumos: cadastro dos ingredientes e histórico de preços     | ✅ Pronto    |
| M2     | Receitas + precificação + ficha técnica                      | 🕒 Em breve  |
| M3     | Produtos, com variações de embalagem                         | 🕒 Em breve  |
| M4     | Estoque                                                      | 🕒 Em breve  |
| M5     | Produção                                                     | 🕒 Em breve  |
| M6     | Clientes                                                     | 🕒 Em breve  |
| M7     | Pedidos                                                      | 🕒 Em breve  |

### Financeiro

| Módulo | O que faz                    | Status      |
| ------ | ---------------------------- | ----------- |
| F1     | Lançamentos                  | 🕒 Em breve |
| F2     | Contas a pagar e a receber   | 🕒 Em breve |
| F3     | Fluxo de caixa               | 🕒 Em breve |
| F4     | DRE (resultado do período)   | 🕒 Em breve |

## Para desenvolvedores

Tecnologias: React + Vite + TypeScript + Tailwind, PWA (`vite-plugin-pwa`), Supabase e deploy na Vercel.

```bash
npm install      # instala as dependências
npm run dev      # roda o app localmente
npm test         # roda os testes (Vitest)
npm run build    # gera a versão de produção em dist/
```

Sem o arquivo `.env` (veja `.env.example`), o app roda em **modo local**: os dados ficam só no navegador (localStorage).

Estrutura de pastas:

```
src/lib/              cálculos puros (custos, precificação, unidades, formatação), com testes *.test.ts
src/modules/          uma pasta por módulo (insumos, config, financeiro, ...)
src/components/       componentes de interface reutilizáveis
src/auth/             login e sessão
src/styles/theme.css  cores e fontes da marca
supabase/migrations/  scripts SQL do banco, rodados em ordem (0001, 0002, ...)
public/               logo e ícones do app
docs/                 guias para o dono do app
```
