# GitHub Pages

A publicação serve o frontend estático em `https://cleitonpn.github.io/detalhamento-tecnico/`. Esse é o endereço esperado; o deploy só fica disponível depois da ativação do Pages e da conclusão do workflow.

O workflow [.github/workflows/pages.yml](../.github/workflows/pages.yml) gera a aplicação em modo local. Os GLBs e projetos ficam no IndexedDB do navegador de quem acessa. Não exige login Firebase e não publica Functions, regras de armazenamento ou dados do Studio. As integrações Firebase continuam disponíveis pelo fluxo próprio descrito em [FIREBASE.md](FIREBASE.md).

## Ativar e publicar

1. No repositório, abrir **Settings → Pages**.
2. Em **Build and deployment → Source**, selecionar **GitHub Actions**.
3. Em **Actions → Publicar no GitHub Pages**, executar **Run workflow** na branch `main`. Os próximos pushes para `main` publicam automaticamente.
4. Conferir o job `deploy` e seu endereço antes de distribuir o link.

Esta instalação usa o repositório público, conforme a configuração feita pelo proprietário. Em outra instalação com repositório privado, o plano da conta precisa permitir Pages nesse tipo de repositório.

## Build em subpasta

```bash
npm ci
VITE_STORAGE_MODE=local npm run build -- --base /detalhamento-tecnico/
npm run preview -- --port 4174 --base /detalhamento-tecnico/
```

Abrir `http://localhost:4174/detalhamento-tecnico/`. O Vite aplica a base ao JavaScript, CSS e favicon. Os decodificadores Draco e Basis/KTX2 usam a mesma base, evitando buscas incorretas na raiz do domínio. O comando normal de desenvolvimento continua usando `/`.

Essa origem tem armazenamento próprio: os projetos salvos em `localhost` não aparecem automaticamente no Pages. Para transferir, manter o GLB original e exportar/restaurar a validação JSON pelo fluxo da aplicação.

## Verificação do build

O build de produção em `/detalhamento-tecnico/` foi verificado no Chromium em 13/10/2026. A demonstração abriu com 10 peças; um GLB sintético comprimido com Draco carregou usando o wrapper e o WASM da subpasta correta. A seleção conservou as medidas, a revisão gerou PDF e o projeto reabriu após recarregar a página. Não houve erro JavaScript nem resposta HTTP de erro nesses cenários. O favicon e os binários WASM de Draco/Basis retornaram conteúdo válido. Essa verificação do Basis cobre a disponibilidade do arquivo, não a decodificação de uma textura KTX2.
