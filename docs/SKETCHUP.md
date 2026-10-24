# SketchUp e 3ds Max no Detalha

## SketchUp (.skp) direto, sem extensão

O Detalha lê o `.skp` do SketchUp **2021 ou mais novo** com um leitor próprio
(`src/lib/skp`), sem SDK e sem conversão. Arquivos de versões anteriores pedem
para salvar de novo numa versão 2021+.

### Formato (engenharia reversa)

- **Cabeçalho do arquivo:**
  - `FF FE FF 0E` + `SketchUp Model` em UTF-16;
  - depois `FF FE FF 0A` + `{26.2.243}`, a versão;
  - em seguida, um **ZIP**.
- **`model.dat`** (dentro do ZIP) é uma árvore de blocos `etiqueta (uint16) + tamanho (uint32) + conteúdo`, toda em little-endian.
- **`materials/<nome>/material.xml`** traz `colorRed/Green/Blue`, `trans` e `useTrans`.
- **Medidas** em polegadas.
- **Identificadores** inteiros de 2 a 4 bytes (o tamanho do bloco diz quantos).

| Etiqueta | Conteúdo |
|---|---|
| `1F4` | raiz do modelo |
| `1F9/1770/1771/157C` | definições de componentes e grupos (`157E` nome, `157D` GUID) |
| `1F6/1388` | entidades do modelo (raiz) |
| `1388` | coleção de entidades: `1389` vértices, `138A` arestas, `138B` faces, `138C` componentes, `138D/1D4C` grupos |
| `9C4` → `5DC/5DE`, `9C5` | vértice: id e posição (3 doubles) |
| `BB8` → `BB9`, `BBA` | aresta: vértice inicial e final (`BBB` = curva) |
| `DAC` → `DAD`, `DAE/1194/1195/FA0` | face: plano (4 doubles) e laços de usos de aresta (`FA1` aresta, `FA2` invertida); o 1º laço de maior área é o contorno, os demais são furos |
| `1964` | instância: `1965` nome, `1966` matriz (eixos X, Y, Z, origem, w), `1967` definição |
| `7D0` | cabeçalho da entidade: `5DC/5DE` id, `7D1` material, `7D2` tag, `7D3` sinalizadores |
| `1F7/30D4/30D5/32C8` | materiais (`32CC` nome, `32CE/2134` pasta no ZIP) |
| `1F8/3A98/3A99/3C8C` | tags (`3C8D` nome) |

### Como o modelo vira peças (`src/lib/skp/scene.js`)

- **Componente com nome próprio** (banqueta, spot, estante): uma peça inteira.
- **Conjunto só de itens pequenos** (abaixo de 10 cm cada, como produtos expostos): uma peça.
- **Grupo ou componente genérico** (`Agrupar#12`, `Componente#3`) com peças de porte dentro: é só um contêiner, e o leitor desce para os filhos. Faces soltas viram uma peça, e itens pequenos soltos são reunidos em "Itens pequenos".
- **Grupo só com faces:** uma peça.
- **Malhas das peças fechadas:** componentes com nome e conjuntos de itens pequenos viram uma malha por material. O levantamento fica leve.

**Teste no projeto FAZZUP (SketchUp 2026, 47 MB):**

| | Quantidade |
|---|---|
| Faces | 147.149 |
| Grupos e componentes | 1.884 |
| Peças | 499 |
| Malhas | 3.836 |

Leitura de cerca de 2 s. Antes do agrupamento, eram 13.867 "peças", com os frascos de esmalte separados.

O teste automático (`tests/skp.test.js`) monta um `.skp` sintético no mesmo formato. Arquivos de clientes ficam em `.local-samples/`, fora do Git.

## 3ds Max (2023+): script de exportação

O `.max` só é legível pelo próprio 3ds Max. O script
`extensions/3dsmax/detalha_exportar.py` gera um `.glb` pronto para o Detalha, com:
- hierarquia de grupos e objetos (cada grupo de primeiro nível é uma peça);
- nomes;
- camadas;
- materiais (inclusive Multi/Sub-Object);
- eixos de cada grupo, para medir certo peças giradas;
- medidas em metros e Y para cima.

**Instalação e uso:**
1. Baixe o script no Detalha, pelo link "Usa 3ds Max? Baixe o exportador" na tela de envio.
2. No 3ds Max: **Scripting › Run Script…**, escolha `detalha_exportar.py`.
3. Se houver objetos selecionados, o script pergunta se exporta só a seleção.
4. Salve o `.glb` e envie no Detalha.

**Teste sem o 3ds Max:** `extensions/3dsmax/simular_cena.py` imita o pymxs com uma cena pequena e grava o `.glb`. O teste automático `tests/max-exporter.test.js` roda essa simulação e abre o resultado pelo leitor do Detalha.
