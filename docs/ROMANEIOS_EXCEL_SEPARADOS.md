# Excel separado por romaneio do período

Em **Operações e Entregas → Faturamento de entregas**, selecione a operação, a categoria e as datas inicial e final. Clique em **Excel por romaneio do período (ZIP)**.

O download contém um ZIP com um arquivo `.xlsx` independente para cada romaneio que corresponde à operação, categoria e período de entrega. A seleção de um romaneio individual na lista não restringe esse lote; o botão considera o período inteiro. **Todas as categorias** inclui todas as categorias desse período. Entregas registradas apenas por mês são incluídas quando o mês se sobrepõe ao período selecionado.

Cada planilha contém a operação, categoria, controle, data de entrega, observações quando preenchidas, quantidade de entregas e os produtos daquele romaneio. Os preços de custo e de venda são os exibidos nessa janela. Os totais de quantidade e de venda têm fórmulas e valores em cache, preservando a exibição em leitores que não recalculam imediatamente. Arquivos de romaneios vazios contêm cabeçalho e total zero.

Os nomes incluem um número sequencial, operação, data de entrega, categoria e controle. A numeração evita sobrescrita mesmo quando dois romaneios têm a mesma data e controle. Caracteres incompatíveis com nomes de arquivos são removidos. Nenhum pedido, estoque ou preço é alterado durante a exportação.

**Gerar Excel** continua gerando um único arquivo consolidado da seleção atual. **Gerar PDF** mantém seu funcionamento.

Validação: `node scripts/test-operation-billing-excel.mjs` (Node 22.18+). O teste abre o ZIP e cada XLSX, verificando separação dos produtos/quantidades, preços, fórmulas, filtros, datas mensais, arquivos vazios e nomes únicos. Compilação: `npm run build`.
