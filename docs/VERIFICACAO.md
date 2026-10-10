# Verificação da primeira base

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

## Limites verificados

- O agrupamento usa a hierarquia e as malhas existentes; não divide automaticamente um sólido em peças físicas de fabricação.
- As vistas são projeções de arestas. Componentes muito complexos usam envelope simplificado identificado no documento.
- A classificação construtiva exige confirmação humana. Materiais de renderização não determinam a construção interna.
- Esta revisão é dimensional. Encaixes, ferragens, reforços, cortes e liberação construtiva serão adicionados com padrões técnicos próprios.
- Não houve deploy nem alteração de dados, regras, sites ou usuários dos aplicativos existentes.
