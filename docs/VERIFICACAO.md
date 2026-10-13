# Verificação da aplicação

Verificação local realizada em 10/10/2026. A aplicação e as Functions foram executadas sem credenciais de produção. Os testes Firebase usam exclusivamente o projeto fictício `demo-detalhamento`.

## Domínio e geometria

14 testes passaram: 5 de geometria, 5 de projeto/integração e 4 de autorização. Cobrem identificadores de instâncias coincidentes, componentes rotacionados, conversão de escala, altura local no eixo Z, agrupamento e separação, materiais obrigatórios, seção física de metalon, confirmação humana e identidade do arquivo importado do Studio.

Comandos:

```bash
npm test
npm run test:server
npm run build
```

O build de produção passou. Three.js gera um chunk de aproximadamente 992 kB antes de gzip; a geração de PDF é carregada sob demanda.

## Firebase emulado

Os 2 testes de regras de Firestore/Storage passaram: membro ativo, isolamento entre equipes, permissões de consulta/edição, reserva de upload, tamanho/MIME e bloqueio de sobrescrita do GLB.

O teste completo das Functions passou: ativação de conta, criação do espaço, reserva e envio do arquivo, verificação de hash/assinatura, salvamento, conflito de versões, revisão imutável, reabertura com revisão registrada e bloqueio de acesso de outra conta. Uma conta suspensa não consegue reativar seu próprio membership.

```bash
npm --prefix functions ci
npm run test:rules
npm run test:backend
```

## Navegador e modelo real

Playwright usa Chromium, com renderização WebGL por software neste ambiente. O teste de demonstração verifica o fluxo de validação de 10 peças, publicação da revisão, downloads JSON/PDF e reabertura do projeto. Os outros cenários conferem a tela de 390 px e a invalidação da confirmação após uma edição.

Os **4 cenários passaram** na rodada final, incluindo o GLB ECBR. O PDF da demonstração foi inspecionado visualmente: 11 páginas, com capa e uma página de vistas para cada peça.

O arquivo ECBR fornecido pelo usuário foi carregado pelo mesmo fluxo de upload da aplicação. Foram encontrados **808 malhas e 33 conjuntos**. O teste verifica o balcão com **2,00 × 1,00 × 0,53 m** e as quatro testeiras com **3,00 × 1,00 × 0,03 m**, além de seleção, isolamento e vista em planta.

O GLB de cliente não faz parte deste repositório. Para repetir essa verificação, usar uma cópia autorizada do mesmo arquivo:

```bash
npx playwright install chromium
npm run test:e2e
DT_GLB_TEST_FILE='/caminho/arquivo.glb' npm run test:e2e
```

Sem essa variável, o teste do modelo ECBR é pulado; os cenários da demonstração continuam sendo executados no CI. Imagens na documentação usam apenas a demonstração sintética.

## Ampliação para GLBs grandes — 13/10/2026

O limite foi ampliado para **200 MiB**, exibidos como 200 MB. A interface, validação compartilhada, reserva nas Functions, importação do Studio e regras de Storage usam o mesmo teto. O upload cloud passou a ser retomável durante a sessão. O prazo da validação é de 180 segundos.

Acima de 50 MiB, o modo leve não decodifica texturas. Mantém a geometria completa, hierarquia, nomes, cores dos materiais e medidas. O buffer usado no hash é reutilizado no parser; o arquivo original permanece intacto no armazenamento.

Verificações concluídas:

- **19 testes de domínio, geometria, carregamento e autorização passaram.** Incluem arquivo de 84 MB, tamanho máximo/excedente, reutilização do buffer e materiais com texturas comuns/Basis indisponíveis: o modo leve lê a geometria sem carregar essas imagens.
- **2 testes de regras passaram**, preservando equipe, papel, reserva, MIME, tamanho e imutabilidade.
- O ciclo das **Functions com o GLB LOTERIAS completo, de 84.181.968 bytes, passou** nos emuladores durante a implementação: reserva, envio retomável, verificação de cabeçalho e SHA-256, salvamento, conflito de versões, publicação e consulta da revisão. Uma reserva acima de 200 MiB é recusada antes do envio. Esse teste verifica transporte/identidade; sua peça de metadados é sintética, não uma validação construtiva do modelo real.
- **5 cenários de navegador passaram na rodada de 13/10/2026.** O LOTERIAS abriu com 5.356 malhas e 106 conjuntos, permitiu selecionar/isolar um conjunto, conferir suas medidas, salvar uma observação e reabrir o projeto preservando a alteração. Não houve erro JavaScript nem evento de perda do contexto WebGL; o contador de decodificações `createImageBitmap` permaneceu em zero. Os outros quatro cenários preservam a demonstração, PDF/revisão, tela pequena, invalidação de confirmação e medidas do ECBR.
- O build de produção passou. As telas do LOTERIAS foram inspecionadas; seus arquivos e capturas não são incorporados ao repositório.

O teste do LOTERIAS levou aproximadamente 2,5 minutos neste Chromium com WebGL por software, incluindo interações, salvamento, reabertura e encerramento do contexto. Isso não representa tempo de carregamento, FPS ou um benchmark de GPU. O limite ampliado não garante fluidez em qualquer computador; quantidade de malhas, materiais e geometria ainda influenciam o desempenho.

Para repetir com uma cópia autorizada do mesmo modelo:

```bash
DT_LARGE_GLB_TEST_FILE='/caminho/LOTERIAS CAIXA-BASE.glb' npm run test:e2e
DT_GLB_UPLOAD_TEST_FILE='/caminho/LOTERIAS CAIXA-BASE.glb' npm run test:backend
```

Sem essas variáveis, o cenário de navegador do LOTERIAS é pulado e o backend usa o cabeçalho sintético pequeno. Não houve deploy do limite novo nas aplicações existentes; instalações cloud precisam atualizar as Functions e integrar o fragmento de Storage às suas regras. O modo local já usa o limite novo ao atualizar este repositório.

Raios e detalhamento de peças curvas permanecem como requisito de implementação separado, descrito em [PECAS_CURVAS.md](PECAS_CURVAS.md). Os testes atuais não validam cálculo de raios.

## Metalon com medidas externas do GLB — 13/10/2026

Por orientação do usuário, a validação de metalon deixou de exigir seção e espessura do tubo. Os campos foram removidos da interface e do caderno/PDF. O material é identificado como Metalon; as dimensões externas, vistas e medidas continuam sendo extraídas do GLB, sem redimensionar a peça. A classificação, o material e a conferência da unidade/medidas continuam no fluxo de validação.

Projetos antigos aceitam a nova regra e apresentam o material com o rótulo atualizado, mantendo seus registros e dimensões. Os testes verificam que campos legados de seção/espessura não bloqueiam confirmação nem geração de revisão.

Vinte testes de domínio, geometria, carregamento e autorização passaram. Três cenários de navegador passaram; o cenário ECBR foi pulado nessa rodada, sem variável de arquivo de cliente. A demonstração confirmou os três pilares de metalon sem digitação de seção ou espessura, registrou revisão e preservou no JSON as dimensões externas de 0,10 × 3,00 × 0,10 m. A extração de texto do PDF conferiu essas mesmas dimensões e o material Metalon, sem campos de perfil, espessura ou valores indefinidos. O build para a subpasta do GitHub Pages passou.

## Limites verificados

- O agrupamento usa a hierarquia e as malhas existentes; não divide automaticamente um sólido em peças físicas de fabricação.
- As vistas são projeções de arestas. Componentes muito complexos usam envelope simplificado identificado no documento.
- A classificação construtiva exige confirmação humana. Materiais de renderização não determinam a construção interna.
- Esta revisão é dimensional. Encaixes, ferragens, reforços, cortes e liberação construtiva serão adicionados com padrões técnicos próprios.
- Não houve deploy nem alteração de dados, regras, sites ou usuários dos aplicativos existentes.
