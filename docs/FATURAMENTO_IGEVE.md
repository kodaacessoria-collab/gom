# Faturamento IGEVE

Disponível no menu para administradores, seguindo o acesso de Operações.

1. Em **Faturamento por romaneio**, filtre a data de entrega e a operação. São relacionadas as operações cadastradas de Maceió, Guaianases (também Gauianases/Guaianazes), Boituva, Mongaguá e Rio de Janeiro.
2. Clique em **Preparar faturamento** para copiar o romaneio de um local de entrega. Informe a empresa, CNPJ e data do faturamento. Empresas cadastradas podem ser selecionadas na sugestão, e empresas adicionais podem ser informadas manualmente.
3. Ajuste produtos, quantidades e preços. O preço de venda de Operações é usado como valor inicial. Zero é permitido; confirme os valores antes de salvar.
4. Em **Romaneios de faturamento**, edite os registros salvos, gere PDF ou use **Complemento** para acrescentar produtos e valores. Cada complemento possui data própria e vínculo com o romaneio base. Preencha apenas os itens adicionais.
5. Em **Relatório por empresas**, filtre a data de faturamento, operação e empresa. O relatório soma base e complementos salvos no período e pode ser exportado em PDF e Excel, com detalhamento.

O faturamento usa cópias dos dados. Alterar quantidades, preços, empresa ou produtos não altera pedidos, estoque, romaneios nem preços em Operações. Alterações posteriores em Operações também não modificam cópias já salvas. Abrir novamente um romaneio de origem recupera seu faturamento existente, evitando importação duplicada.

Os registros são armazenados em `app_shared_state`, já utilizado pelo sistema, com uma chave independente por romaneio (`gom_igeve_invoice_...`). Nenhuma migração adicional é necessária. A gravação verifica a versão anterior para impedir que uma edição concorrente sobrescreva outra. Em caso de conflito, cancele o editor, atualize e reabra o registro. A atualização dos dados ocorre ao entrar no menu ou clicar em **Atualizar**.

O agrupamento por empresa utiliza CNPJ sem pontuação, quando preenchido, ou nome normalizado. Para manter a consolidação correta, use o mesmo CNPJ em todos os registros da mesma empresa.

Validação de regras: `node scripts/test-igeve-billing.mjs` (Node 22.18+ com suporte a TypeScript). Compilação: `npm run build`.
