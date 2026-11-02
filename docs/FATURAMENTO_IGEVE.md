# Faturamento IGEVE

Disponível no menu para administradores, seguindo o acesso de Operações.

1. Em **Faturamento por romaneio**, filtre a data de entrega, a operação e a categoria. São relacionadas as operações cadastradas de Maceió, Guaianases (também Gauianases/Guaianazes), Boituva, Mongaguá e Rio de Janeiro.
2. Clique em **Preparar faturamento** para copiar o romaneio de um local de entrega. Informe a empresa, CNPJ e data do faturamento. Empresas cadastradas podem ser selecionadas na sugestão, e empresas adicionais podem ser informadas manualmente.
3. Ajuste produtos, quantidades e preços. O preço de venda de Operações é usado como valor inicial. Zero é permitido; confirme os valores antes de salvar.
4. Em **Romaneios de faturamento**, edite os registros salvos, gere PDF ou use **Complemento** para acrescentar produtos e valores. Cada complemento possui data própria e vínculo com o romaneio base. Preencha apenas os itens adicionais.
5. Em **Faturamento por operação/local**, consulte a soma dos romaneios de cada local no período de **entrega** escolhido, inclusive os que ainda não foram preparados no faturamento. A tabela mostra quantidades e valores separados de romaneios base e complementos, além do total por local e geral. Use **Local** para selecionar um único local e **Ver romaneios** para conferir ou abrir os registros incluídos. As exportações em PDF e Excel incluem o resumo por operação/local e o detalhamento, respeitando os filtros.
6. Em **Relatório por empresas**, filtre a data de faturamento, operação, categoria e empresa. O relatório soma base e complementos salvos no período e pode ser exportado em PDF e Excel, com detalhamento.

O filtro **Categoria** está disponível nas quatro abas; selecione **Todas as categorias** para remover esse filtro. No relatório por empresas, totais e exportações consideram apenas os registros das categorias selecionadas.

Clique no cabeçalho de qualquer coluna das tabelas principais para alternar entre ordem crescente e decrescente. A seta indica o sentido atual; cada aba mantém sua própria ordenação. Textos usam a ordem em português, valores são comparados numericamente e datas seguem a ordem cronológica.

O faturamento usa cópias dos dados. Alterar quantidades, preços, empresa ou produtos não altera pedidos, estoque, romaneios nem preços em Operações. Alterações posteriores em Operações também não modificam cópias já salvas. Abrir novamente um romaneio de origem recupera seu faturamento existente, evitando importação duplicada.

Os registros são armazenados em `app_shared_state`, já utilizado pelo sistema, com uma chave independente por romaneio (`gom_igeve_invoice_...`). Nenhuma migração adicional é necessária. A gravação verifica a versão anterior para impedir que uma edição concorrente sobrescreva outra. Em caso de conflito, cancele o editor, atualize e reabra o registro. A atualização dos dados ocorre ao entrar no menu ou clicar em **Atualizar**.

O agrupamento por local separa operações diferentes e usa o identificador do local quando disponível. Registros antigos recuperam esse identificador pelo romaneio de origem ou por nome único no cadastro da operação; sem esse vínculo, usam o nome normalizado do local dentro da operação. Na aba por operação/local, a consulta usa a data de entrega do pedido de origem. O faturamento já salvo substitui a estimativa do mesmo romaneio, sem duplicar valores; seus preços editados são preservados, mesmo quando a data de faturamento está fora do período de entrega escolhido. Complementos acompanham o período de entrega de sua origem. Romaneios a preparar usam os preços de venda atuais, com indicação de estimativa na tela e de situação no detalhamento e nas exportações. Produtos sem preço cadastrado entram com valor zero. Clique em **Preparar faturamento** no detalhamento para informar empresa e conferir valores antes de salvar. A consulta não cria registros automaticamente. O filtro de empresa seleciona apenas os registros já associados à empresa, pois os romaneios a preparar ainda não têm empresa definida. Se a origem for removida, faturamentos com data de entrega preservada continuam disponíveis nesse período.

O agrupamento por empresa utiliza CNPJ sem pontuação, quando preenchido, ou nome normalizado. Para manter a consolidação correta, use o mesmo CNPJ em todos os registros da mesma empresa.

Validação de regras: `node scripts/test-igeve-billing.mjs` (Node 22.18+ com suporte a TypeScript). Compilação: `npm run build`.
