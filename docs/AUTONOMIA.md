# Autonomia: fase 1 (regras + memória)

**Objetivo:** o Detalha pré-preenche cada peça, e o humano só confere. Não usa IA de
linguagem. São regras geométricas próprias e uma memória das decisões humanas do espaço
de trabalho (`src/lib/auto`).

## Camada 1: regras geométricas (`rules.js`)

As regras leem:
- medidas na orientação da peça;
- espessura;
- altura em relação ao piso;
- distância até o centro do stand;
- nome da peça e do componente (no SketchUp);
- tag;
- materiais visuais.

Para cada peça sugerem **tipo**, **material de construção** e **revestimento**, com
uma nota de confiança (0 a 1) e até 3 motivos.

| Leitura | Exemplo de motivo |
|---|---|
| Fora do stand (> 20 m do centro) | "Fora da área do stand (a 60 m)." |
| Piso | plano horizontal ≥ 2 m² junto ao chão |
| Testeira | painel acima de 2 m, 0,15–1,6 m de altura |
| Parede | painel vertical que nasce no chão (ou conjunto L/U, a conferir) |
| Metalon | perfil de seção ≤ 10 cm, comprimento ≥ 6× a seção |
| Prateleira/tampo, lateral | chapa horizontal acima do chão; chapa vertical baixa |
| Revestimento | superfície sem espessura (imagem, adesivo, lona) |
| TV, iluminação, mobiliário | nome, ou proporção 16:9 / peça pequena no alto / volume no chão |

**Material de construção:** sai da espessura. Uma chapa a até 1,2 mm de uma espessura
do catálogo (4, 6, 9, 10, 15, 18 mm) é essa chapa; até 2,5 mm, é o arredondamento do
modelo. Peças em caixa, como paredes de 10 cm, ficam com MDF 15 mm, a conferir.

**Revestimento:** sai do nome do material visual (Bagum, carpete, Decorflex, Lycra).

## Camada 2: impressão digital e memória (`fingerprint.js`, `index.js`)

Cada peça leva três chaves, iguais para a mesma peça em qualquer posição ou rotação:

| Chave | Composição | Confiança da memória |
|---|---|---|
| **exata** | medidas (2 mm) + triângulos + área (1%) | 96% |
| **forma** | medidas (1 cm) + nome de verdade (nomes automáticos ficam de fora) | 90% |
| **medida** | só as medidas (1 cm), pista fraca | 62%, ou reforça a regra |

**Quando grava:** ao validar uma peça, a decisão humana vai para a memória do espaço de
trabalho:
- no modo local, no IndexedDB, loja `memory`;
- na nuvem, em `dt_workspaces/{id}/memory`, pelas funções `dt_memoryLookup` e
  `dt_memoryRecord`.

**Decisões divergentes:** se a mesma peça já recebeu decisões diferentes, a confiança
cai 25 pontos.

**Propagação no mesmo projeto:** validar uma peça deixa verdes, na hora, as peças
idênticas.

## Semáforo e fluxo

- 🟢 **verde (≥ 85%):** o botão **"Aceitar N sugestões verdes"** confirma as medidas e valida em lote.
- 🟡 **amarelo (55–85%):** pré-preenchido; o filtro **Conferir** mostra só essas e as vermelhas.
- 🔴 **vermelho (< 55%):** o humano decide.

O sistema nunca valida sozinho. Só pré-preenche o que o humano não mexeu. O rodapé mostra
a taxa de **sugestões aceitas sem mudança**, a métrica para chegar aos 80%.

## Resultado no projeto FAZZUP (SketchUp, 499 peças)

| Situação | Verdes | Amarelas | Vermelhas |
|---|---|---|---|
| Só regras, 1ª vez | 191 | 285 | 23 |
| Depois de 3 ações humanas | 371 validadas (74%) | | |
| Mesmo stand aberto de novo (memória) | 371 já ao abrir | | |

As 3 ações humanas foram:
1. aceitar as verdes;
2. validar 1 cantoneira, o que propagou para 179 iguais;
3. aceitar de novo.
