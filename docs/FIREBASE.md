# Firebase: instalação independente e servidor compartilhado

## Duas configurações

**Independente:** usar um projeto Firebase próprio, configuração web própria, `firebase.json` e suas regras. A aplicação não depende das contas, projetos ou ordens do Studio.

**Compartilhada com Studio:** usar `personalizacao-stand`, a configuração web desse projeto e `firebase.shared.json`. Publicar apenas o site novo e a codebase `detalhamento`. Integrar os fragmentos às regras existentes antes de usar upload cloud. Nunca publicar as regras independentes sobre o projeto compartilhado.

O segredo `FIREBASE_SERVICE_ACCOUNT` fica somente no servidor/Actions. Não é possível nem necessário recuperar o valor de uma secret do GitHub para montar o frontend. A configuração do aplicativo web é pública e deve ser copiada do Console Firebase ou do módulo público do Studio para `.env.local`.

## Configuração do frontend

```dotenv
VITE_STORAGE_MODE=firebase
VITE_FIREBASE_API_KEY=<chave-publica-web>
VITE_FIREBASE_AUTH_DOMAIN=personalizacao-stand.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=personalizacao-stand
VITE_FIREBASE_STORAGE_BUCKET=personalizacao-stand.firebasestorage.app
VITE_FIREBASE_APP_ID=<app-id-web>
VITE_FIREBASE_FUNCTIONS_REGION=southamerica-east1
VITE_WORKSPACE_ID=uset
```

Para uma instalação independente, usar a configuração de seu próprio Firebase e `VITE_WORKSPACE_ID=user_<uid>` (UID da conta no Firebase Auth). A UI faz login por e-mail e senha; as contas são provisionadas fora da aplicação nesta base. Não existe cadastro público.

Para o espaço `uset`, configurar `DT_ENABLE_STUDIO_INTEGRATION=true` na codebase e acessar com um usuário `usuarios/{uid}` do Studio que tenha `papel: admin` e `ativo !== false`. **Projetos → Preparar espaço da equipe** inicializa o espaço para o primeiro administrador. Administradores adicionais devem receber membership da equipe; isso não é concedido automaticamente por serem usuários do Studio.

Para uma instalação independente, a inicialização aceita somente o espaço `user_<uid>` do próprio usuário. A primeira criação exige a custom claim `detalhamento: true`, atribuída pelo administrador com o Admin SDK (`getAuth().setCustomUserClaims(uid, { ...claimsAtuais, detalhamento: true })`). Depois de atribuir a claim, renovar o token ou fazer login novamente. Equipes comerciais adicionais podem ser provisionadas por administração segura com o Admin SDK. O frontend não escreve os membros diretamente. Uma conta suspensa não consegue reativar seu próprio acesso pela inicialização.

Membership:

```text
dt_workspaces/{workspaceId}/members/{uid}
  active: true
  role: owner | editor | viewer
```

Owner/editor gravam pelas Functions. Viewer consulta. Todos os endpoints conferem membership no servidor; alterações e publicação de revisões repetem a autorização dentro da transação.

## Dados e arquivos

```text
dt_workspaces/{workspaceId}
  members/{uid}
  uploads/{projectId}_{hash}.glb
  projects/{projectId}
    revisions/{revision}

Storage:
dt_workspaces/{workspaceId}/projects/{projectId}/models/{hash}.glb
```

Arquivos são reservados antes do upload. As regras conferem equipe, papel, proprietário da reserva, expiração, tamanho e MIME. A Function confere assinatura GLB 2.0 e SHA-256 antes de salvar. O GLB não é sobrescrito; uma nova identidade representa outro arquivo.

O limite é de **200 MiB (209.715.200 bytes)**, exibido na interface como 200 MB. Frontend, domínio, Functions e regras de Storage usam o mesmo limite. O upload cloud é retomável em caso de interrupções de rede durante a sessão; a validação do arquivo usa leitura em fluxo no servidor. O prazo da chamada de validação foi ampliado para 180 segundos. Em instalações existentes, atualizar Functions e o fragmento de Storage junto com o frontend; regras antigas de 50 MB continuarão bloqueando uploads maiores. O modo leve altera apenas a visualização: o Storage recebe o GLB original, incluindo suas texturas.

Revisões são criadas no servidor e não podem ser editadas diretamente pelo cliente. Controle de versão impede que duas sessões sobrescrevam seus trabalhos silenciosamente.

## Regras compartilhadas

1. Obter as regras mais recentes da conversa principal/branch em uso, incluindo as alterações do app de produção.
2. Inserir `firebase/firestore.fragment` dentro do bloco de documentos e `firebase/storage.fragment` dentro do bloco de arquivos.
3. Conferir regras globais: permissões são combinadas por OR. Um wildcard já permissivo pode anular a restrição de um fragmento. As referências inspecionadas terminavam em bloqueio geral, mas verificar o estado atual.
4. Testar as regras combinadas em emuladores, cobrindo também preservação dos fluxos existentes.
5. Publicar essas regras combinadas pelo fluxo que já gerencia o projeto compartilhado.

`scripts/assemble-rules.mjs` monta as regras **independentes**, não faz merge com o Studio. `firebase.shared.json` não contém opções de deploy de Firestore/Storage justamente para preservar as regras existentes.

As regras de Storage usam leituras do Firestore. Na primeira ativação em produção, verificar a autorização de integração Storage/Firestore solicitada pelo Firebase. Para leitura de GLB no navegador, o bucket precisa permitir CORS para o domínio novo; manter os domínios existentes e incluir o do detalhamento.

## Publicação manual

O workflow `deploy.yml` é acionado somente por `workflow_dispatch`. Usa `FIREBASE_SERVICE_ACCOUNT` e recebe um ID de site novo. Hosting tem o target `detalhamento`, e Functions têm a codebase `detalhamento`. A publicação padrão mantém o frontend em modo local; para modo cloud, configurar as variáveis web públicas do repositório e selecionar o modo Firebase no workflow.

Configuração equivalente via CLI:

```bash
npm ci
npm --prefix functions ci
npm run build
npx firebase target:apply hosting detalhamento <site-novo> --project personalizacao-stand
npx firebase deploy --config firebase.shared.json --only functions:detalhamento,hosting:detalhamento --project personalizacao-stand
```

O site precisa existir antes de aplicar o target. Não apontar para o site do Studio. Nenhuma publicação, configuração de IAM, alteração de regras ou migração de usuários foi executada nesta entrega.

## Emuladores

```bash
npm ci
npm --prefix functions ci
npm run test:rules
npm run test:backend
```

Para testar o app cloud completo, configurar projeto web `demo-detalhamento`, habilitar `VITE_USE_EMULATORS=true`, iniciar Auth/Firestore/Storage/Functions e criar uma conta e membership fictícios. Emuladores usam portas 9099, 8080, 9199 e 5001. Não usar dados ou credenciais reais nesses testes.
