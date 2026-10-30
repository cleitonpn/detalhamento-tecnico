# Inteligência: progresso das entregas

## Sexto incremento — fechamento de implementação das fases 1 e 2

Este é o estado atual; os incrementos seguintes são históricos. A implementação está preparada para homologação, não para liberação automática de fabricação. Consulte o [roteiro de teste](TESTE_FASES_1_2.md).

### Fase 1: revisão e modelos densos

- Navegação pesquisável pela hierarquia real, com seleção da peça sem mudar seu agrupamento. Limites de navegação e de extração continuam explícitos.
- Análise espacial em Worker, preparação parcelada dos dados, progresso, cancelamento e reanálise. Os buffers do renderizador não são transferidos. Limites de geometria geram análise parcial identificada, não amostragem silenciosa apresentada como completa.
- Aceitar uma identidade contextual registra método, arquivo, unidade, justificativa e vínculos. A evidência acompanha o salvamento e a revisão; mudar a escala exige reconferência. Pode-se descartar a evidência sem apagar a identidade.
- Tela e avaliador de gabarito independente: campos humanos inicialmente vazios, importação/exportação, cobertura, coincidências e divergências, inclusive em decisões em lote. A comparação usa a previsão automática original, não a decisão corrigida. Não alimenta treinamento nem altera o projeto.

### Fase 2: componentes e análise de curvas

- Receitas versionadas podem declarar painéis, perfis, reforços e marcadores de ligação por expressões limitadas de parâmetros, sem execução de código. O esboço de balcão é não aprovado; fontes, materiais, condições e aprovação continuam obrigatórios.
- Painéis aparecem como contornos e perfis como eixos tracejados laranja, separados do existente. Ligações são marcadores com referência a detalhe técnico, não fixadores dimensionados. Erro de regra, dimensão ou limite bloqueia a geração inteira, sem quantitativos parciais.
- Escopo, contraindicações, geometria e identidades admitidas são editáveis no catálogo. Contraindicações textuais exigem leitura humana; não equivalem a cálculo automático de resistência. Versões aprovadas não são sobrescritas.
- Coleta de triângulos parcelada e análise de seções em Worker, com cancelamento e limites explícitos. Tela e PDF usam o mesmo resultado de superfície. Mudança de método/gerador exige reconferência explícita.
- Seções variáveis distinguem indícios de variação linear/não linear de raio. Superfícies cônicas, múltiplos raios e curvas livres não recebem desenvolvimento cilíndrico exato. Painéis retangulares exigem referência prismática, sem transformar balcão curvo em caixa.
- O anexo de construção conserva fontes, referências e pendências, com quantitativos preliminares por tipo. A revisão continua dimensional e `constructionRelease: false`.

### Novos arquivos autorizados

O Drive fornecido permitiu obter Litoral Verde, FAZZUP, ECBR e LOTERIAS. Os binários e resultados privados permanecem fora do Git.

| Modelo | Peças / itens agrupados | Nós / vínculos | Pares candidatos / possíveis | Seções avaliadas |
| --- | ---: | ---: | ---: | --- |
| Litoral Verde | 59 / 34 | 365 / 497 | 146 / 1.711 | 6 prismáticas, 2 variáveis |
| FAZZUP | 480 / 59 | 5.027 / 8.363 | 2.751 / 114.960 | 6 prismáticas, 8 variáveis, 1 circular, 1 de múltiplos raios |

Essas contagens vêm do avaliador local sem memória prévia. Litoral apresentou 25 contatos horizontais e 21 laterais; FAZZUP, 208 e 49. Houve análise parcial de superfícies em 98 e 2.618 pares, respectivamente. Nenhum desses números é medida de precisão. O avaliador síncrono de linha de comando levou cerca de 35 segundos no FAZZUP; a interface usa o Worker e não tem promessa comprovada de conclusão em cinco minutos.

### Validação e limites de homologação

154 testes da aplicação e 8 testes unitários das Functions passaram. Regras Firebase (3 testes) e integração com autenticação, armazenamento, salvamento de catálogo/proposta/evidência, preservação de versões e revisão (1 cenário integrado) passaram em emuladores de `demo-detalhamento`. O bloqueio de rede histórico não impediu esta rodada. Nenhum comando publicou ou acessou dados de produção.

A rodada completa de navegador executou os 19 cenários, sem ignorados: 18 passaram e o ECBR revelou uma expectativa antiga de quatro linhas, embora as quatro testeiras estivessem agrupadas em uma linha `×4`. A verificação foi corrigida para exigir o agrupamento e quatro peças físicas distintas com as medidas esperadas no projeto exportado; o ECBR passou na repetição. Os cenários aprovados incluem os cinco SKP/DWG, LOTERIAS com 5.356 malhas e reabertura sem texturas, arte, construção, componentes, hierarquia, gabarito, cancelamento, evidência contextual, PDF e tela pequena. ECBR foi testado na variante LED de 808 malhas, não na variante LONAS de 806.

O build em modo local com base `/detalhamento-tecnico/` passou. O teste do build servido confirmou demonstração, hipótese contextual e análise construtiva, com os dois Workers carregados sob essa base, sem erros de página ou HTTP. Permanecem os avisos de tamanho de bundle e de compatibilidade da biblioteca DWG. Os emuladores executaram Functions com Node 24 deste ambiente, emitindo aviso por o projeto declarar Node 22; isso não é validação do runtime de produção.

Ainda exigem homologação humana: gabarito real por peça, documentos de fornecedores, padrões construtivos da empresa, estabilidade, ancoragens, fixações e adequação à fabricação. Não há planificação geral de superfícies livres, lista de corte ou biblioteca corporativa central. Artes e gabaritos continuam locais. Importação, folha técnica e PDF não foram integralmente transferidos para Workers. Perdas geométricas dos parsers DWG continuam sinalizadas, não reconstruídas.

## Quinto incremento — seções, hierarquia e estrutura proposta

### Entregue nesta rodada

- A análise de construção passa a cortar os triângulos em 20%, 50% e 80% da altura local e comparar contornos. Vértices internos de triangulação colineares são removidos antes do ajuste. Os candidatos circulares de superfície usam identificadores `S*`, separados dos raios `R*` das arestas do desenho.
- Cilindro candidato exige raio, centro, extensão angular e extremidades compatíveis nas três seções, com tolerância entre cortes de 2 mm. Cones/esferas com cortes diferentes são classificados como seção variável, não cilindro. Múltiplos centros e curvas irregulares ficam pendentes; não recebem um desenvolvimento circular único.
- A análise é limitada a 50 mil triângulos e 8 mil segmentos brutos por seção, sem amostragem silenciosa. Limite atingido, seção ausente ou coordenada inválida impedem a inferência de superfície suficiente. Três seções não comprovam continuidade entre elas, nem recuperam geometria omitida pelo importador; o resíduo do ajuste não mede a precisão do projeto original.
- O grafo de hierarquia conserva os vínculos malha–peça e os grupos dos caminhos reais da cena. Registra grupos de repetição pela impressão geométrica, sem aprovar cópias automaticamente. Limites de nós/arestas são explícitos. O painel mostra associação e repetição da peça.
- Novas hipóteses contextuais: painel vertical em contato verificado com piso identificado; faixa elevada em contato e alinhada a parede identificada. Vegetação em contato com parede ganha contexto decorativo sem mudar sua identidade. As hipóteses não confirmam apoio, fixação ou carga.
- Uma nova versão de receita pode declarar distribuição de montantes verticais: espaçamento máximo entre eixos, folga em cada ponta do percurso e altura como comprimento de eixo. Exige aprovação com fonte/responsável, materiais aprovados, parâmetros completos, referência geométrica confirmada e conferência da estrutura já modelada.
- A prévia 3D mostra **eixos tracejados laranja**, separados da malha existente. Não são sólidos com posição final dos perfis, nem incluem travessas, reforços ou conexões. Geram-se contagem, comprimento de eixos, reserva de perda configurada, espaçamento efetivo e área de referência sem descontar aberturas. Esses dados seguem também no anexo do PDF, sempre como quantitativos preliminares, nunca lista de corte/compra.
- A prévia é bloqueada se altura/largura diferirem da referência além da tolerância, se a receita não tiver método de distribuição, se houver pendências, ou se exceder 500 membros. Não gera estrutura parcial. Círculo completo sem folga não duplica o montante na emenda. Não soma automaticamente proposta e peças modeladas.
- Corrigido cache de análise: cada mapa de geometria tem cache próprio, com referencial da peça na chave. Modelos diferentes com mesmos IDs/dimensões não compartilham análises.

### Avaliação local dos modelos

Rodada sem memória prévia, com `node scripts/evaluate-models.mjs /caminho/modelo --sections`. As seções abaixo foram avaliadas nas peças classificadas como parede, testeira ou marcenaria; não são um gabarito humano.

| Modelo | Nós / vínculos de hierarquia | Grupos de repetição | Perfis prismáticos candidatos | Circulares candidatos | Irregulares | Seção variável |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Lintec | 112 / 123 | 8 | 7 | 0 | 0 | 0 |
| ODEEN | 74 / 73 | 4 | 2 | 0 | 0 | 2 |
| EDEN ripado | 874 / 873 | 42 | 11 | 1 | 4 | 2 |

Nenhuma dessas análises de seção atingiu os limites. O candidato circular do EDEN está no balcão `part-0-0-321`; isso não comprova que todo o balcão tenha uma única superfície circular ou que deva usar receita de parede. Os alertas anteriores de importação continuam válidos. Contagens de classe e semáforo não foram usadas como medida de precisão.

### Verificação e pendências

141 testes da aplicação e 8 testes unitários das Functions passaram. Build de produção passou, mantendo os avisos já conhecidos de biblioteca DWG e bundle. Os 5 fluxos direcionados de navegador passaram, incluindo criação de receita com distribuição aprovada, materiais, parâmetros, escolha de referência, exibição real de 13 eixos no 3D e PDF. A regressão completa terminou com **11 cenários aprovados e 2 ignorados**, sem falhas: incluiu upload dos três modelos, arte, construção, revisão, PDF, reabertura e tela pequena. Os ignorados dependem dos GLBs privados ECBR/LOTERIAS ausentes.

O teste Firebase foi tentado com projeto de demonstração e cache em `/workspace/.cache/firebase/emulators`, sem produção. O download do emulador retornou **403: Domain forbidden** em `storage.googleapis.com`. A integração permanece **não validada**, conforme as restrições observadas pela skill `cloud-environment-runtime`. O teste de integração foi ampliado para verificar catálogo/proposta, rejeição de sobrescrita de versão e cópia na revisão, mas essas novas verificações ainda não foram executadas com emuladores. A liberação desse domínio depende de revisão da configuração de rede do ambiente, não de alteração do projeto ou do proxy local.

As fases 1 e 2 **não estão integralmente encerradas**. Permanecem: validação humana por peça e benchmark independente; Litoral Verde/FAZZUP disponíveis por meio autorizado; relações contextuais adicionais e visualização completa da hierarquia; decomposição de balcões e receitas de travessas/reforços/conexões com padrões reais da empresa; superfícies gerais fora do caso prismático/cilíndrico; avaliação de desempenho/cancelamento em modelos densos; integração Firebase. Catálogo aprovado da empresa não foi inventado: os exemplos aprovados dos testes são sintéticos. Referências antigas `R*` não são migradas para `S*` por aproximação; se a referência não existir na análise atual, a proposta fica pendente para seleção explícita. Não houve deploy.

## Quarto incremento — fases 1 e 2 em paralelo

O escopo desta rodada é a evolução do contexto/classificação (fase 1) e curvas/catálogo construtivo (fase 2). Os incrementos abaixo são históricos, não uma lista cumulativa de limitações atuais.

### Fase 1: contexto e escolha da face

- Contatos laterais e inclinados agora exigem sobreposição real de triângulos coplanares, inclusive em peças giradas. Vãos nos envelopes não bastam para afirmar contato.
- Chapa horizontal com contato lateral verificado em parede pode receber hipótese de prateleira. Não confirma fixação ou carga. As hipóteses continuam dependendo de aceitação humana.
- O painel diferencia orientação do contato, proximidade e análise parcial de superfícies. Há limite de 256 triângulos por categoria/peça, além do limite de pares; ausência de contato em análise parcial não comprova separação.
- O caderno de arte permite escolher uma face plana vertical por clique na peça isolada no 3D. O ponto e a normal são transformados para o referencial da peça, em metros. Triângulos invertidos e rotação têm testes próprios.
- A troca de projeção foi corrigida para esperar a câmera e seus controles correspondentes. Trocar de face mantém a exigência de reconferir áreas manuais.

Reavaliação local, sem memória prévia:

| Modelo | Pares candidatos / possíveis | Horizontais | Laterais | Inclinados | Pares com superfícies parcialmente analisadas |
| --- | ---: | ---: | ---: | ---: | ---: |
| Lintec | 56 / 465 | 11 | 35 | 0 | 4 |
| ODEEN | 90 / 630 | 2 | 5 | 0 | 30 |
| EDEN ripado | 828 / 51.681 | 86 | 79 | 10 | 453 |

Não foi atingido o limite de pares. O ODEEN gerou duas hipóteses contextuais, ainda sem gabarito humano. As contagens não medem precisão nem recuperam sólidos/faces ausentes. Persistem os alertas de unidade e duas faces omitidas do ODEEN, e falha de leitura de sólidos do EDEN.

### Fase 2: propostas e catálogo versionado

- Contrato puro compartilhado com as Functions para fichas de materiais, receitas, referências de versões e propostas por peça. O esquema 1 continua compatível com projetos antigos.
- Quatro receitas iniciais não aprovadas: parede reta, parede curva, testeira curva e balcão. Separam estrutura, fechamento e acabamento. Não inventam seção, espessura, espaçamento, folga, perda ou raio mínimo.
- O painel **Solução construtiva proposta** abre a análise sob demanda. A equipe escolhe receita, camadas cadastradas e parâmetros; vê todas as pendências. Referências do modelo são mostradas separadamente dos parâmetros informados.
- O cadastro do projeto permite criar materiais e novas versões de materiais/receitas, com fonte, responsável e data de aprovação declarada pela equipe. Não é certificação do sistema. As receitas próprias herdam a estrutura e os campos da base; a interface não é um editor arbitrário de regras.
- Versões antigas não são substituídas pela interface nem pelo salvamento remoto. Desfazer/refazer preserva o registro de versões. Propostas mantêm suas referências originais até alteração explícita.
- Arcos detectados em arestas são apenas candidatos. Para desenvolvimento circular, a equipe escolhe o arco, a vista e a superfície interna/externa/neutra e confirma que representa o fechamento, não só um canto arredondado. O valor R × ângulo é geométrico, **não comprimento de corte**.
- Curvas livres, forma orgânica e análise simplificada não recebem planificação circular exata. A referência do raio mínimo deve coincidir com a superfície escolhida; não há conversão implícita entre faces/linha neutra.
- Mudança de unidade exige reconferir os parâmetros construtivos, sem escalá-los silenciosamente. Peças com propostas ou conferências diferentes não compartilham uma folha agrupada.
- Propostas, catálogo e receitas seguem no projeto e na cópia independente da revisão. O PDF inclui anexo paginado de dados, proveniência e pendências por peça; a tela permite consultar o mesmo conteúdo. A revisão permanece **dimensional**, com `constructionRelease: false` e sem lista de corte.

Verificações concluídas: 130 testes da aplicação, 8 testes unitários das Functions e build de produção passaram. Os fluxos direcionados de navegador passaram para seleção real de face no WebGL, cadastro de versões, proposta incompleta, salvamento/reabertura e PDF. Uma malha sintética de raio 2 m e arco de 90° atravessou o analisador real, recuperando raio e desenvolvimento de aproximadamente π m; o fluxo de referência explícita também passou no navegador.

Foram verificados 11 cenários distintos de navegador, incluindo upload dos três modelos reais. Na rodada completa, 9 passaram, 2 atingiram o limite de 5 segundos ainda nas etapas de carregamento e 2 foram ignorados por ausência dos GLBs privados ECBR/LOTERIAS. As esperas de importação/reabertura passaram a aguardar a condição final por até 20 segundos, sem espera fixa. Na repetição direcionada dos arquivos de fluxo e construção, os 5 cenários disponíveis passaram, preservando as verificações de revisão, PDF e persistência; o ECBR permaneceu ignorado. O build mantém avisos de tamanho de bundle e da biblioteca DWG, sem erro de compilação.

Limites: sem dimensionamento de estabilidade, conexões, ancoragens ou lista de corte; sem planificação geral de superfícies livres; sem validação independente de precisão por peça. Catálogo é do projeto, não uma biblioteca corporativa central. Persistência cloud dos campos foi implementada no contrato/salvamento, mas não houve teste de integração Firebase com emuladores nem deploy. As artes continuam locais. Litoral Verde e FAZZUP seguem não testados por excederem o limite de transferência de 32 MiB dos anexos, até serem disponibilizados por outro meio autorizado.

## Terceiro incremento — contexto espacial e tipos de interferência

- Índice de envelopes em metros reduz pares candidatos antes da análise geométrica. Objetos muito grandes usam uma lista de exceções, evitando explosão de células. Limites de pares/superfícies são explícitos.
- Grafo distingue proximidade de envelopes, possível apoio e contato horizontal compatível com a geometria. A verificação estreita usa interseção de triângulos horizontais em XZ. Tolerâncias padrão: proximidade 10 mm; contato 0,1 mm. Contatos laterais e capacidade portante não são verificados.
- O painel mostra as relações da peça. Chapas em contato com corpo identificado como balcão ou com dois perfis verticais podem receber hipóteses de tampo de balcão/mesa. Só a aceitação humana altera a identidade; material, destino e construção não são aprovados por essa hipótese.
- A detecção de interferências usa o índice e gera **obstrução visual**, nunca ordem automática de recorte. A interface oferece recorte confirmado e área de segurança, com representação e legenda distintas na folha/PDF.
- Edições manuais deixam de ser sobrescritas/duplicadas ao detectar novamente. Tipos diferentes não se fundem. Trocar de face sinaliza as áreas manuais para nova conferência, inclusive no documento.
- Áreas antigas sem tipo mantêm a leitura de recorte legado e recebem aviso para revisão, sem regravação silenciosa.

Avaliação dos modelos locais (grafo sem memória prévia):

| Modelo | Pares possíveis | Pares candidatos verificados | Contatos horizontais compatíveis |
| --- | ---: | ---: | ---: |
| Lintec | 465 | 56 | 11 |
| ODEEN | 630 | 90 | 2 |
| EDEN ripado | 51.681 | 828 | 86 |

Nenhum atingiu o limite de pares. Não surgiram hipóteses de tampo nesses três modelos; os dois casos de tampo foram exercitados com geometria sintética conhecida. As contagens não são avaliação independente de precisão e não recuperam geometria que o importador não leu.

Verificações: 109 testes da aplicação e 8 das Functions passaram. Foram validados 9 cenários de navegador, incluindo tipos de interferência, preservação de recortes ao detectar novamente, PDF, reabertura, contexto no painel e importação dos três modelos. Dois cenários GLB continuam sem execução por ausência dos arquivos. O cenário de arte precisou de correção no seletor do teste (nome acessível do combobox) e passou na repetição direcionada. O build de produção passou; não houve publicação ou validação em produção.

Limites restantes: contatos laterais/inclinados, fixações, relações de toda a hierarquia e padrões construtivos ainda precisam de evolução. O grafo é reconstruído a partir da geometria, não se torna uma decisão construtiva salva automaticamente. As artes continuam com persistência local por projeto.

## Segundo incremento — superfícies, identidade e importação

- O painel permite registrar identidade (parede, mobiliário, vegetação, logo etc.) e destino separadamente. Alterar o destino não apaga a identidade. O caderno técnico segue o destino efetivo, preservando o comportamento antigo quando o campo não existe.
- O caderno de arte apresenta primeiro suportes candidatos com faces planas verticais detectadas. Mostra dimensão da face, em vez da caixa inteira do objeto. “Mostrar todos os objetos” permite avaliar exceções com confirmação explícita; luzes virtuais ficam bloqueadas. Sem face detectada, o painel não cria um gabarito retangular fictício.
- Artes já salvas permanecem acessíveis, mesmo se o suporte não for candidato pelas regras novas. A escolha de orientação e o cálculo de interferências existentes são preservados.
- Diagnósticos do arquivo (divergência de unidade, falhas de sólidos e faces omitidas) são persistidos, mostrados na interface e levados ao rodapé das folhas e ao pacote de revisão. O backend preserva esses metadados no salvamento.
- Em importações novas, peças técnicas com alertas do arquivo exigem conferência explícita adicional. Alertas são globais e não afirmam quais peças foram afetadas. Trocar a unidade invalida essa conferência; separar malhas preserva os alertas.
- Projetos antigos mantêm decisões confirmadas, sem migração destrutiva. O vocabulário novo é validado pelo domínio compartilhado. Peças com identidades/destinos diferentes não são agrupadas na mesma folha.
- Decisões com identidade/destino explicitamente preenchidos são preservadas no projeto, mas não entram na memória/treino legado, que ainda só representa tipo/material/acabamento. Isso evita ensinar um rótulo incompleto; o aprendizado multidimensional fica para a evolução do modelo.

Resultados dos arquivos autorizados na avaliação local:

| Modelo | Peças | Suportes com faces candidatas | Objetos virtuais bloqueados |
| --- | ---: | ---: | ---: |
| Lintec | 31 | 5 | 2 |
| ODEEN | 36 | 4 | 0 |
| EDEN ripado | 322 | 17 | 11 |

São contagens de candidatos, não gabarito humano nem precisão medida. Litoral Verde e FAZZUP continuam indisponíveis pelo limite de transferência.

Verificações desta fase: 103 testes da aplicação, 8 testes das Functions e build de produção passaram. Foram exercitados 8 cenários de navegador (arte/exceção/PDF/reabertura, identidade/destino, os três modelos autorizados e os três fluxos de demonstração). Dois cenários GLB permanecem não executados por ausência dos arquivos. Uma repetição do fluxo de demonstração excedeu os 5 segundos de espera inicial durante um build concorrente; o fluxo passou isoladamente após o build, mantendo todas as verificações. A integração Firebase com emuladores não foi executada; não há validação nem deploy em produção.

Limites desta fase: ainda não há grafo espacial geral, escolha de face por clique no 3D, desenvolvimento de superfícies curvas, separação entre recorte/obstrução na edição das interferências nem persistência cloud das artes. O filtro aproveita a extração de faces já existente e seus limiares; faces pequenas/curvas podem exigir trabalho futuro. Os diagnósticos expõem perdas de importação, sem reconstruir a geometria ausente.

## Primeiro incremento

## Comportamento implementado

- Jardim vertical e mobiliário com identidade explícita são avaliados antes de heurísticas de fragmentação. Uma poltrona ripada não recebe justificativa de ícones.
- O envelope externo de uma parede não define MDF 15 mm. Material desconhecido continua vazio e impede a validação quando obrigatório.
- Sugestões guardam versão do motor, papel semântico inicial e pontuações independentes de tipo/material. Medidas e construção não recebem pontuação inventada. As pontuações são evidências, não probabilidades calibradas.
- Divergências relevantes entre regras, memória e aprendizado impedem o estado verde.
- Lote exige os campos válidos e a conferência dimensional anterior das peças técnicas. Itens fora do detalhamento seguem a dispensa dimensional existente no domínio. Registra `confirmationMethod: batch` e não alimenta memória/treinamento. Confirmação pelo painel registra `individual`.
- O nome gerado pelo classificador não volta a ser evidência textual de regras/treino; o nome importado é preservado e alterações humanas continuam utilizáveis.
- Ao mudar tipo, material, acabamento ou versão do motor, a sugestão anterior fica em `decisionHistory`. Decisões já confirmadas não são recalculadas.
- Quando o aprendizado troca o material sugerido, a justificativa antiga desse material não é reaproveitada.

## Compatibilidade

Campos adicionados ao esquema 1, sem migração destrutiva. Projetos antigos confirmados mantêm seus materiais e decisões. Projetos não confirmados podem receber sugestões novas; as anteriores ficam no histórico. As revisões já registradas continuam sendo cópias independentes.

Não foi feito deploy ou alteração de dados de produção.

## Modelos autorizados e reprodução

Arquivos de clientes ficam fora do Git. Para testar importação, medidas finitas e sugestões sem memória prévia:

```bash
node scripts/evaluate-models.mjs '/caminho/modelo.skp'
node scripts/evaluate-models.mjs '/caminho/modelo.dwg'
```

Execute um arquivo por processo. O comando usa os mesmos parsers/construtores de cena da aplicação e imprime diagnósticos, unidade e contagens. Não mede precisão de classificação sem gabarito humano.

Para exercitar upload, seleção e apresentação das evidências no navegador:

```bash
DT_MODEL_TEST_FILES='["/caminho/modelo.skp","/caminho/modelo.dwg"]' npm run test:e2e
```

O teste é opt-in; nenhuma dependência de arquivo privado é adicionada ao CI.

Observações da rodada inicial:

| Modelo | Peças | Faces informadas pelo parser | Limitações observadas |
| --- | ---: | ---: | --- |
| Lintec | 31 | 52.978 | Parser não registrou falhas de faces |
| ODEEN 3 det | 36 | 478.632 | Unidade inferida diverge do cabeçalho; 26 sólidos convertidos e 2 faces omitidas; biblioteca emitiu código 64 |
| EDEN ripado | 322 | 701.262 | Unidade cm; diagnóstico registra falha na leitura de sólidos |

O Lintec manteve 31 peças e 18 itens agrupados antes/depois. Verdes passaram de 19 para 18; amarelas de 12 para 13. A mudança de semáforo não comprova ganho de acerto: falta gabarito por peça.

Litoral Verde e FAZZUP enviados ultrapassam o limite de transferência de 32 MiB desta sessão e não foram avaliados nesta rodada.

Verificações: 95 testes da aplicação e 8 das Functions passaram; build de produção passou. No Chromium, os três modelos acima passaram por upload, seleção e apresentação de evidências; a demonstração verificou validação, revisão, geração de PDF e reabertura. Os cenários GLB ECBR e LOTERIAS não foram executados por ausência desses arquivos. As regras/emuladores Firebase não foram revalidados neste incremento.

## Trabalho restante do plano

Este incremento não conclui a taxonomia multidimensional, o grafo espacial, as receitas construtivas, a revogação de exemplos, a calibração independente, o treinamento em Worker nem a persistência cloud das artes. O material pela espessura continua sendo candidato heurístico: ainda falta distinguir chapas reais de envelopes curvos ou compostos. O aprendizado anterior não é apagado/reclassificado automaticamente.

Elegibilidade de faces, identidade/destino e alertas persistentes foram tratados no segundo incremento acima. Próxima frente: relações espaciais e curvas/catálogo construtivo, com padrões técnicos aprovados da empresa para receitas de fabricação.
