# Requisito: peças curvas no detalhamento

Testeiras, balcões e paredes curvas precisam de medidas de curvatura e desenhos que conservem seu contorno. **A base atual mede o envelope e projeta arestas; ainda não calcula ou valida raios.** Este documento registra o requisito e a estratégia para uma etapa própria de implementação.

## O que é possível obter do GLB

Quando o contorno representa um arco circular, é possível ajustar um círculo aos pontos da geometria e obter:

- Raio, centro e orientação do arco no referencial da peça.
- Ângulo, comprimento do arco, corda e flecha.
- Raios interno e externo quando os dois contornos estão presentes e correspondem à mesma peça.
- Espessura geométrica, altura e posição no stand, sujeitas à conferência humana.

O raio nominal não costuma existir no GLB: o exportador aproxima a curva por segmentos. O valor obtido deve ser apresentado como **estimativa geométrica**, junto com a resolução da malha e o desvio do ajuste. O operador confirma ou informa o raio de projeto. Um arco com poucos segmentos ou pequena abertura pode produzir um raio muito incerto mesmo com baixo desvio; o sistema precisa identificar essa ambiguidade.

Uma curva livre, elipse ou contorno com vários arcos não deve receber um raio único. Deve ser classificada como curva composta/livre e representada por seu contorno e medidas adequadas. Não assumir circularidade apenas pelo nome da peça.

## Fluxo para um operador sem formação em arquitetura

1. Selecionar a peça ou o componente correto. Um balcão completo pode ter frente, tampo e estrutura com contornos diferentes.
2. A ferramenta destaca os contornos candidatos em planta ou no plano local da curva.
3. O operador escolhe o contorno de referência: interno, externo ou outro plano explicitamente identificado. Uma curva inclinada exige seu próprio plano.
4. O sistema propõe o tipo de curva e mostra centro, raios, ângulo, comprimento e desvio do ajuste, com o contorno original sobreposto.
5. O operador confirma as medidas ou corrige o raio com uma referência técnica. Alterações de unidade, geometria ou contorno invalidam a confirmação.
6. A revisão registra os valores e sua origem; o PDF inclui planta cotada e detalhes da peça curva.

## Estratégia geométrica

- Trabalhar em metros e no referencial local da peça, preservando rotação, escala e espelhamento.
- Extrair bordas ou uma seção da malha no plano escolhido. Quando necessário, unir vértices coincidentes com tolerância documentada, sem alterar os IDs das malhas de origem.
- Organizar os segmentos em contornos e distinguir arco, trecho reto, contorno interno/externo e elementos que não pertencem à peça.
- Ajustar o círculo com normalização de coordenadas e medir os desvios em relação ao contorno original. Verificar amostragem, abertura e condicionamento do ajuste antes de sugerir um raio.
- Validar se os contornos interno e externo são concêntricos e têm espessura coerente. Não inferir um segundo raio sem dados suficientes.
- Para um arco confirmado: comprimento = raio × ângulo em radianos. Identificar a referência desse comprimento; o desenvolvimento de uma chapa curvada depende também da construção e do material.

## Caderno e contrato de integração

Adicionar um bloco geométrico versionado por peça com tipo de curva, plano, centro, raios, início/fim, ângulo, comprimento, corda, flecha, desvio, resolução da amostra, origem e confirmação humana. Vincular esse bloco ao hash do GLB e aos IDs dos contornos/malhas. Studio e produção devem receber as mesmas referências e medidas na revisão aprovada.

O PDF deve incluir vista em planta com centro e chamadas de raio, dimensões e contorno real. Um envelope retangular simplificado não substitui o detalhe de uma peça curva. Se não houver dados suficientes, marcar o detalhamento como pendente, em vez de apresentar um raio inventado.

Para peças cilíndricas simples, pode ser gerado um desenvolvimento da superfície. Curvas compostas, superfícies com dupla curvatura e chapas dobradas exigem regras adicionais. Espessura nominal, eixo neutro, raio mínimo de curvamento, estrutura interna, emendas e método construtivo não podem ser deduzidos apenas do aspecto externo do GLB.

## Verificações antes de liberar a função

- Arcos conhecidos de 90°, 180° e 360°, com raios interno/externo e contornos cruzando o zero angular.
- Peças rotacionadas, espelhadas e exportadas em m/cm/mm.
- Malhas indexadas e não indexadas, segmentos duplicados e diferentes resoluções de exportação.
- Arcos pequenos ou com poucos pontos: resultado incerto deve exigir referência manual.
- Elipses, curvas livres e arcos compostos: não aceitar um raio único incorreto.
- Balcão composto: medidas do tampo e da frente devem corresponder aos contornos escolhidos.
- Preservação das medidas e confirmação na revisão, JSON, PDF e integrações.

Solicitação do usuário registrada em 10/10/2026. Repositórios: [detalhamento](https://github.com/cleitonpn/detalhamento-tecnico.git), [Studio](https://github.com/cleitonpn/personalize-stand-forum-.git) e [produção](https://github.com/cleitonpn/produ-o-personalizada.git).
