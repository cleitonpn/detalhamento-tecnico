# Testar as fases 1 e 2

## Escopo

O sistema separa identidade, destino, geometria observada e solução proposta. Uma revisão dimensional não libera fabricação. Parâmetros comerciais, seções, limites de curvatura, reforços e detalhes de conexão precisam de fontes verificadas e aprovação da equipe. Os padrões aprovados dos testes automatizados são apenas sintéticos.

## Identificação, contexto e hierarquia

1. Abra SKP, GLB, DWG, DXF ou ZIP. Confira a unidade e os alertas de importação antes de validar peças.
2. Selecione uma peça e confira **Identidade do objeto** e **Destino da peça** separadamente. Alterar o destino não apaga a identidade.
3. A análise espacial roda em segundo plano, com cancelamento e reanálise. Proximidade de envelopes não é contato confirmado. Mesmo contato confirmado não comprova suporte ou carga.
4. Em **Explorar hierarquia do modelo**, expanda grupos, busque nome/caminho e selecione uma malha para abrir sua peça. Essa navegação não altera o agrupamento. Limites de profundidade, nós e vínculos são explícitos.
5. Aceitar uma identidade contextual registra método, arquivo, unidade, justificativa e vínculos. Trocar a escala exige reconferência. É possível descartar a evidência sem apagar a identidade escolhida.

## Arte

1. No caderno de arte, comece pelas superfícies candidatas. Mobiliário, vegetação e equipamentos não se tornam automaticamente suportes; auxiliares de renderização ficam bloqueados.
2. Escolha a face pelo seletor ou clicando no 3D da peça isolada. O seletor aceita faces planas verticais detectadas, não qualquer superfície.
3. A detecção gera **obstrução visual**, não ordem de recorte. Converta em recorte ou área de segurança somente após conferir. Redetectar preserva edições manuais.
4. Trocar de face exige revisar áreas manuais. Os avisos acompanham a folha/PDF.

## Solução construtiva

1. Selecione uma única peça e abra **Solução construtiva proposta**. A coleta cede execução ao navegador e a análise de seções roda em Worker, com cancelamento. Acima dos limites, fica pendente em vez de assumir uma superfície completa.
2. Abra **Catálogo e padrões construtivos**. Cadastre fichas com dados do fornecedor e crie nova versão de receita a partir de uma base. Versões antigas são preservadas. Aprovação é uma declaração da equipe, não certificação do sistema.
3. Defina geometria e identidades admitidas, escopo e contraindicações. Textos de contraindicação são instruções de revisão humana, não verificações automáticas de resistência ou fixação.
4. Na peça, escolha materiais de estrutura, fechamento e acabamento e informe os parâmetros. A caixa externa de um conjunto não revela a espessura de chapa.
5. Para montantes, a receita precisa declarar o significado de espaçamento, folga e altura. Selecione e confirme referência reta/circular e confira a estrutura existente. A prévia mostra eixos, não posição final dos perfis.
6. Para balcões/componentes, há um esboço **não aprovado** de duas laterais, tampo e base. A definição JSON admite somas de parâmetros e fatores finitos, sem código executável. Perfis/reforços usam `start` e `end`; painéis usam `center`, `size` e `normalAxis`; ligações são marcadores `center` com `detail` apontando para documento técnico. Não são gerados reforços ou fixações arbitrários. Revise antes de aprovar.
7. Painéis retangulares exigem referência prismática. Não se converte um balcão curvo em caixa retangular automaticamente. Uma receita circular pode admitir identidade de balcão e distribuição de montantes, se a equipe configurar e aprovar essas condições.
8. Nas curvas, confira os raios das seções em 20%, 50% e 80% da altura. Três cortes compatíveis são evidência limitada, não prova de continuidade. Cones/esferas/curvas múltiplas ou livres não recebem um único desenvolvimento cilíndrico exato. R × ângulo é da referência escolhida, nunca comprimento de corte.
9. A prévia laranja fica separada do modelo existente. Quantitativos não descontam encaixes, usinagens e recortes nem se somam automaticamente ao existente. Ligações são símbolos de referência, não parafusos dimensionados.
10. Mudanças de método/gerador exigem atualização explícita da conferência antes de recalcular. Catálogo, receitas e decisões seguem na cópia independente da revisão. O PDF inclui fontes e pendências.

## Gabarito humano e comparação

Em **Dados do projeto → Revisar gabarito da classificação**, informe o responsável e anote identidades/destinos esperados após inspeção independente. Os campos começam vazios; não são preenchidos com a previsão ou com a classificação corrigida. A tela mostra cobertura, coincidências, divergências e divergências em peças confirmadas em lote. Campos não revisados não entram como acertos.

O gabarito fica no navegador, vinculado ao hash, unidade e particionamento; exporte para preservar/compartilhar. Importar exige arquivo/unidade compatíveis, IDs conhecidos e rótulos válidos. Isso não altera o projeto nem alimenta memória/treinamento.

Para comparação fora do navegador, exporte também o projeto em **Dados do projeto → Exportar validação**:

```bash
node scripts/evaluate-benchmark.mjs projeto.json gabarito.json
node scripts/evaluate-models.mjs '/caminho/modelo.skp' --sections
node scripts/evaluate-models.mjs '/caminho/modelo.dwg' --sections
```

O avaliador de modelos aceita SKP/DWG/DXF; GLB é exercitado no navegador. Execute um modelo denso por processo. Não há medida de precisão global sem gabarito humano independente, nem promessa comprovada de cinco minutos.

## Verificações

```bash
npm test
npm run test:server
npm run build
npm run test:rules
npm run test:backend
```

Os dois últimos comandos usam somente `demo-detalhamento` em emuladores. Num ambiente com diretório pessoal não gravável, configure `FIREBASE_EMULATORS_PATH` e `XDG_CONFIG_HOME` para diretórios graváveis, preservando TLS/checksums. Esses comandos não publicam Firebase de produção.

Testes de modelos são opt-in, com arquivos autorizados fora do Git:

```bash
DT_MODEL_TEST_FILES='["/caminho/Lintec.skp","/caminho/EDEN.dwg","/caminho/LITORALVERDE.skp","/caminho/FAZZUP.skp"]' \
DT_GLB_TEST_FILE='/caminho/ECBR-2-PAINEIS-LED.glb' \
DT_LARGE_GLB_TEST_FILE='/caminho/LOTERIAS.glb' npm run test:e2e
```

Os testes específicos de ECBR/LOTERIAS conferem as variantes de referência (808 e 5.356 malhas), não qualquer arquivo de mesmo nome. Binários, capturas e dados de clientes não acompanham o commit.

## Commit, ambiente e site são etapas diferentes

Um commit local não publica site nem ambiente. Para testar num site remoto, o commit precisa estar numa branch remota acessível ao workflow.

- **GitHub Pages:** `Publicar no GitHub Pages` gera modo local, com armazenamento no navegador. Push para `main` aciona o workflow; também existe execução manual. Ver [GITHUB_PAGES.md](GITHUB_PAGES.md).
- **Firebase:** `Publicar detalhamento (manual)` exige destino, modo e credencial configurados. No modo nuvem, publique também as Functions desta revisão para preservar os novos campos. Ver [FIREBASE.md](FIREBASE.md). Não publique regras de projeto independente sobre o projeto compartilhado do Studio.
- Publicar a configuração do ambiente de desenvolvimento não publica frontend/Functions.

Consulte [INTELIGENCIA_PROGRESSO.md](INTELIGENCIA_PROGRESSO.md) para resultados, histórico e limites. Validar documentos do fornecedor, soluções da empresa e gabaritos reais continua sendo responsabilidade humana; testes de software não substituem essas decisões.
