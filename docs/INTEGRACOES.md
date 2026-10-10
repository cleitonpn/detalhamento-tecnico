# Contratos com o Studio e a produção

## Estado desta entrega

Os adaptadores e endpoints foram preparados neste repositório. Nenhum código do Studio, produção ou orçamento foi alterado. Não há sincronização ativa ou gravação em `ordensProducao`/`ops_orders`.

A integração cloud com Studio é uma consulta opcional, desativada por padrão (`DT_ENABLE_STUDIO_INTEGRATION=false`). Ela exige uma conta administrativa ativa do Studio, além de acesso ao espaço desta aplicação. A referência exportada para produção é um JSON versionado; o consumo automático será acrescentado no app de produção posteriormente.

## Studio → Detalha

Contrato `studio.detailing-source`, versão 1:

```json
{
  "contract": "studio.detailing-source",
  "schemaVersion": 1,
  "orderId": "ordem_123",
  "proposalId": "proposta_123",
  "modelId": "modelo_123",
  "revision": 2,
  "name": "Stand aprovado",
  "file": { "hash": "sha256-do-glb-final", "bytes": 8223388 },
  "elements": [
    { "id": "parede_01", "name": "Parede C01", "pieceKeys": ["chave-auxiliar-da-peca"], "kind": "wall" }
  ]
}
```

O hash deve ter 64 caracteres hexadecimais e coincidir com o GLB aberto. O adaptador só associa conjuntos cujas malhas apontem inequivocamente para um mesmo elemento. Nome e associação podem ser reaproveitados; material de render e aprovação comercial não são validação construtiva.

`dt_getStudioSource` lê uma ordem liberada, calcula o hash do GLB aprovado e fornece as associações disponíveis no modelo. O fluxo atual de exportação do Studio pode achatar hierarquias e alterar posições. Por isso, esse endpoint identifica `bindingStatus: requires-reconciliation`. Associações que não coincidam permanecem pendentes em vez de serem adivinhadas.

### Próxima alteração no Studio

1. Acrescentar IDs estáveis dos elementos e de suas malhas ao manifesto e aos `extras` do GLB final, ou fornecer uma tabela equivalente de associação.
2. Incluir hash do arquivo final e referência à revisão liberada.
3. Transportar dimensões, referencial e dados validados, incluindo objetos removidos/substituídos e complementos.
4. Exportar o contrato a partir da versão aprovada, sem exigir classificar novamente as peças já identificadas.
5. Acrescentar especificações construtivas nesta aplicação usando os vínculos existentes.

Não passar URLs arbitrárias ao servidor para baixar modelos. O endpoint resolve o caminho canônico da ordem no próprio Firebase. A aplicação só importa a referência, e o operador abre o GLB correspondente nesta fase.

## Revisão técnica

Contrato `detalhamento.technical-package`, versão 1, produzido por `createRelease`:

- `projectId`, `name`, `client`, `fair`, `revision` e `createdAt`.
- `status: dimensionally_validated`.
- `scope: dimensional-survey` e `constructionRelease: false`.
- `source.file`: nome, tamanho e hash do GLB.
- `source.sourceUnit`: unidade original.
- `source.integration`: origem do Studio, quando houver vínculo.
- `parts`: geometria, dimensões, nomes e especificações confirmadas.
- `materials`: referências técnicas utilizadas.
- `artifacts`: reservado para documentos/arquivos. Na revisão cloud, inclui o GLB protegido. O PDF desta base é baixado no navegador; ainda não é automaticamente enviado ao servidor.

`readTechnicalPackage` valida o contrato. Os documentos atuais não devem ser interpretados como aprovação de fabricação pela produção.

## Detalha → Produção

Contrato `production.detailing-reference`, versão 1:

```json
{
  "contract": "production.detailing-reference",
  "schemaVersion": 1,
  "orderId": "ordem_123",
  "sourceRevision": 2,
  "technicalProjectId": "id-do-projeto-tecnico",
  "technicalRevision": 1,
  "fileHash": "sha256-do-glb-final",
  "scope": "dimensional-survey",
  "constructionRelease": false
}
```

### Próxima alteração no app de produção

1. Receber/consultar a referência técnica por ordem e revisão de origem.
2. Conferir o hash e a revisão antes de relacionar documentos à configuração aprovada.
3. Permitir consultar o caderno e sua situação de validação.
4. Preservar documentos de revisões anteriores e identificar documentos desatualizados quando houver nova ordem/revisão.
5. Não sobrescrever dados operacionais nem transformar validação dimensional em aprovação construtiva.
6. Definir as permissões de leitura dos documentos para as equipes antes de ativar a sincronização. Uma referência importada não concede acesso automaticamente.

## Instalação independente

Não é obrigatório preencher `source.integration`. Um projeto avulso continua gerando seu caderno e pacote. Ao vender separadamente, pode-se usar outro Firebase e integrar a outros consumidores pelo mesmo contrato, sem as coleções específicas do Studio.
