# Arquitetura e decisões da base

## Independência do produto

O frontend React/Vite, o domínio, o catálogo e as Functions pertencem a este repositório. Não existe dependência `file:../studio`, import de código de outro checkout ou acesso obrigatório a coleções do Studio para o fluxo próprio.

As interfaces de persistência oferecem `list`, `get`, `save` e `publish`. O modo local usa IndexedDB; o modo Firebase usa as mesmas entidades com controle de acesso no servidor. Isso permite executar a aplicação isoladamente e compartilhar infraestrutura quando desejado.

## Organização

| Diretório               | Responsabilidade                                                      |
| ----------------------- | --------------------------------------------------------------------- |
| `src/components`        | Visualização 3D, inspeção, caderno e login.                           |
| `src/lib/model.js`      | Identidade do arquivo, agrupamento, medidas e associações das malhas. |
| `src/lib/loader.js`     | GLTFLoader com Draco, Meshopt e KTX2.                                 |
| `src/lib/drawings.js`   | Projeção de arestas e documentos dimensionais.                        |
| `src/lib/vendor/studio` | Analisador e sugestões de papéis reaproveitados do Studio.            |
| `src/domain`            | Criação e edição de projetos, reunião e separação de grupos.          |
| `functions/domain.js`   | Validação compartilhada e contrato de revisão, sem SDK de servidor.   |
| `src/services`          | Persistência local/cloud e adaptadores de integração.                 |
| `functions`             | Operações autorizadas, verificação dos GLBs e revisões.               |
| `firebase`              | Regras independentes e fragmentos para projeto compartilhado.         |

## Identificação e medição

Cada arquivo tem SHA-256. As malhas têm caminhos estáveis dentro de sua hierarquia; o identificador de uma malha só é interpretado em conjunto com a identidade daquele arquivo. Peças coincidentes continuam separadas, em vez de colidir pelo material e pelo centro.

O coletor do Studio fornece medidas iniciais e uma chave auxiliar de compatibilidade. Os conjuntos usam a hierarquia original e um referencial local quando ele é ortogonal. Assim, girar um balcão não aumenta sua largura artificialmente pela caixa global. Conjuntos reunidos manualmente usam os eixos do stand, comportamento informado ao usuário. Transformações com cisalhamento também usam envelope global.

Nos componentes detectados, o eixo mais alinhado à vertical do stand representa a altura. O maior dos dois eixos restantes representa a largura; o outro, a profundidade. O referencial acompanha essa ordenação, inclusive para arquivos com altura local no eixo Z e testeiras laterais. As medidas e vistas continuam sujeitas à conferência humana.

`sourceUnit` converte a origem para metros. Alterar a unidade invalida as confirmações. O formato glTF normalmente usa metros, mas uma exportação pode estar em escala incorreta.

O agrupamento inicial preserva os componentes; não reconhece automaticamente a construção interna de um volume externo. O usuário pode reunir conjuntos ou separá-los nas malhas existentes. Particionamento topológico de sólidos e criação automática de peças de fabricação são extensões futuras.

## Validação humana

Sugestão e confirmação são campos diferentes. O tipo sugerido pode ser usado na interface, mas só o operador confirma a peça. Para metalon, o levantamento usa as medidas externas da geometria do GLB e não exige digitar seção ou espessura do tubo. A conferência da unidade e das medidas extraídas continua sendo necessária. A espessura de um painel visível não vira automaticamente espessura de MDF.

Uma edição das especificações invalida a confirmação das peças afetadas. Cada revisão registra uma cópia independente. O contrato atual possui `scope: dimensional-survey` e `constructionRelease: false`; a futura liberação construtiva exigirá regras e dados próprios.

## Materiais

O catálogo técnico deriva de `data/complete-seed.json` do [orçamento USET](https://github.com/cleitonpn/or-amento-uset), referência `f5edae88ca0e13bc3ba25621c3fcaaca9302d4c9`. Foram extraídos códigos, descrições, unidades e medidas explícitas de materiais selecionados. Preços e custos não foram copiados.

O script `scripts/import-materials.mjs` permite repetir a extração usando um checkout local do orçamento. Medidas comerciais são referências e precisam ser confirmadas. Sarrafos com nomenclatura ambígua não tiveram suas seções inferidas. Metalon tem uma referência genérica de material; suas dimensões no levantamento vêm do GLB. Campos de seção/espessura existentes em projetos antigos não bloqueiam a validação nem são exibidos no caderno atual. Revisões e metadados históricos são preservados.

## Reaproveitamento do Studio

Origem: [personalize-stand-forum-](https://github.com/cleitonpn/personalize-stand-forum-), commit `6c2680a32049bc86cb7fce56a0206da1d2125dee`.

- `studio/src/lib/glb/analyze.js` e `roles.js`: coleta e heurísticas auxiliares.
- `studio/scripts/copiar-decoders.mjs`: preparação dos decodificadores locais.
- `studio/src/styles/tokens.css`: paleta, superfícies, tipografia e formas da interface.
- `studio/src/components/Viewer.jsx`: referência de carregamento, seleção e navegação. O visualizador deste produto foi adaptado para trabalhar sem o fluxo comercial do Studio e detectar suporte KTX2 no renderer real.

As cópias estão no próprio repositório e foram formatadas. Atualizações futuras do Studio não devem sobrescrever automaticamente alterações deste produto.

## Desempenho e documentos

O Canvas renderiza sob demanda, limita a resolução e reaproveita a geometria. Materiais de destaque são clonados, preservando o original. Geometrias, materiais e texturas são liberados ao trocar o modelo.

Arquivos de até 200 MiB são aceitos. Acima de 50 MiB, o loader usa modo leve automaticamente: não carrega nem decodifica texturas, incluindo fontes Basis/WebP/AVIF. Geometria, hierarquia, nomes e cores dos materiais são preservados. A visualização informa esse modo; ele não reduz polígonos nem gera um arquivo convertido. O buffer lido para o SHA-256 é reutilizado no parser, evitando uma segunda leitura integral. O arquivo original é salvo no IndexedDB ou enviado por upload retomável ao Storage.

As vistas usam arestas da geometria projetadas no referencial da peça. Malhas cujo número de arestas ultrapasse o limite por vista são mostradas como envelope simplificado, com indicação no PDF. Não usar essa simplificação como detalhe de fabricação.

Esta base gera vistas individuais; plantas executivas completas, ligações estruturais, otimização de corte e padrões construtivos permanecem como próximas entregas.

Peças curvas exigem extração de contornos e cálculo de curvatura além do envelope atual. O requisito está registrado em [PECAS_CURVAS.md](PECAS_CURVAS.md), incluindo estimativa de raio, incerteza, validação humana e saída no caderno.
