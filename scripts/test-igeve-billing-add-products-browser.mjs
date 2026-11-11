import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { billingOperationPriceKey } from '../src/lib/igeveBilling.ts';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/igeve-billing-add-products-test.html', `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client';
import IgeveBilling from '/src/components/IgeveBilling.tsx'; import '/src/index.css';
createRoot(document.getElementById('root')).render(React.createElement(IgeveBilling));
</script></body></html>`);
const operation = { id: 'guaianases', name: 'Operação Guaianases (SP)', city: 'Guaianases' };
const points = ['Rubi', 'Mendonça'].map((name, i) => ({ id: `point-${i}`, name, operationId: operation.id, code: `1${i ? 'B' : 'A'}`, address: 'Rua de teste, 38', neighborhood: 'Jardim Mirian' }));
const month = new Intl.DateTimeFormat('sv-SE', {timeZone:'America/Sao_Paulo'}).format(new Date()).slice(0,7);
const orders = ['Estocáveis', 'Dietas e Fórmulas', 'Proteínas'].map((category, i) => ({
  id: `order-${i}`, operationId: operation.id, category, deliveryDate: `${month}-01`, importedAt: `2026-10-30T13:2${i}:00Z`,
  deliveries: points.map(point => ({ id: `${i}-${point.id}`, deliveryPointId: point.id, items: [{ product: `Produto ${i}`, unit: 'UN', quantity: i + 1 }, ...(i === 0 ? [{product: 'Sem ajuste', unit:'KG', quantity:4}] : [])] })),
}));
const db = new Map([
  ['gom_delivery_operations', [operation]], ['gom_delivery_points', points], ['gom_delivery_operation_orders', orders],
].map(([key, value]) => [key, {key, value, updated_at:'2026-11-01T00:00:00Z'}]));
const catalog = [
  ['AMIDO MILHO', 'Estocáveis', operation.id, '200G', 12.9],
  ['SEM PREÇO', 'Estocáveis', operation.id, 'UN', null],
  ['OUTRA OPERAÇÃO', 'Estocáveis', 'rio', 'UN', 99],
  ['CARNE', 'Proteínas', operation.id, 'KG', 50],
  ['Produto 0', 'Estocáveis', operation.id, 'UN', 10],
].map(([product, category, operationId, unit, salePrice]) => ({ key: billingOperationPriceKey(operationId, category, product, unit), product, category, operationId, unit, salePrice }));
for (const entry of catalog) db.set(entry.key, { key: entry.key, value: entry, updated_at: '2026-11-01T00:00:00Z' });
const browser = await chromium.launch({...(process.env.CHROME_EXECUTABLE_PATH ? {executablePath: process.env.CHROME_EXECUTABLE_PATH} : {}), headless:true, args:['--no-sandbox']});
try {
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/rest/v1/**', async route => {
    const req = route.request(), url = new URL(req.url());
    let body;
    if (url.pathname.endsWith('/companies')) body = [];
    else if (req.method() === 'GET') {
      const filter = url.searchParams.get('key') || '';
      const prefix = filter.replace(/^like\./, '').replace(/\\/g, '').replace(/%$/, '');
      body = [...db.values()].filter(row => filter.startsWith('in.') ? filter.includes(row.key) : row.key.startsWith(prefix));
    } else {
      const row = req.postDataJSON(); db.set(row.key, row); body = {updated_at:row.updated_at};
    }
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
  });
  await page.goto(`${process.env.GOM_TEST_URL || 'http://127.0.0.1:5174'}/tmp/igeve-billing-add-products-test.html`);
  await page.getByRole('button', {name:'Faturamento por operação/local', exact:true}).click();
  await page.locator('.igeve-category-filter summary').click();
  await page.getByRole('checkbox', {name:'Estocáveis',exact:true}).check();
  await page.locator('.igeve-category-filter summary').click();
  await page.getByRole('button', {name:'Preparar faturamento',exact:true}).first().click();
  const dialog = page.getByRole('dialog');
  const companyName = dialog.getByLabel('Empresa para faturamento', {exact:true});
  const companyCnpj = dialog.getByLabel('CNPJ', {exact:true});
  const registerCompany = dialog.getByRole('button', {name:'Cadastrar empresa para faturamento',exact:true});
  const billingCompanyName = 'EMPRESA FICTÍCIA DE FATURAMENTO LTDA';
  await companyName.fill(billingCompanyName);
  await companyCnpj.fill('11.111.111/1111-11');
  await registerCompany.click();
  await dialog.getByText('Informe a razão social e um CNPJ válido para cadastrar a empresa.').waitFor();
  const companyKey = 'gom_igeve_billing_company_11222333000181';
  assert.equal(db.has(companyKey), false);
  await companyCnpj.fill('11222333000181');
  await registerCompany.click();
  await dialog.getByText('Empresa cadastrada e selecionada para este faturamento.').waitFor();
  assert.equal(db.get(companyKey).value.legal_name, billingCompanyName);
  assert.equal(await companyCnpj.inputValue(), '11.222.333/0001-81');
  assert.equal(await dialog.locator('#igeve-companies option').count(), 1);
  await registerCompany.click();
  await dialog.getByText('Este CNPJ já está cadastrado. A empresa existente foi selecionada.').waitFor();
  assert.equal(await dialog.locator('#igeve-companies option').count(), 1);
  await companyName.fill('OM LOGISTICA E DISTRIBUICAO LTDA');
  await dialog.getByRole('button', {name:'Adicionar produtos da tabela',exact:true}).click();
  const selection = dialog.getByLabel('Produto da tabela', {exact:true});
  await selection.waitFor();
  const options = await selection.locator('option').allTextContents();
  assert.equal(options.length, 3, 'Somente produtos ausentes da mesma operação/categoria');
  assert.ok(!options.some(text => /CARNE|OUTRA OPERAÇÃO|Produto 0/.test(text)));
  await dialog.getByLabel('Buscar produto na tabela').fill('amido');
  assert.equal(await selection.locator('option').count(), 2);
  await selection.selectOption(catalog[0].key);
  await dialog.getByLabel('Quantidade a adicionar').fill('-1');
  await dialog.getByRole('button', {name:'Incluir produto selecionado',exact:true}).click();
  await dialog.getByText('Informe uma quantidade maior que zero, com até três casas decimais.', {exact:true}).waitFor();
  await dialog.getByLabel('Quantidade a adicionar').fill('2.5');
  await dialog.getByRole('button', {name:'Incluir produto selecionado',exact:true}).click();
  assert.equal(await dialog.getByLabel('Produto 3', {exact:true}).inputValue(), 'AMIDO MILHO');
  assert.equal(await dialog.getByLabel('Quantidade entregue 3', {exact:true}).inputValue(), '0');
  assert.equal(await dialog.getByLabel('Ajuste faturamento 3', {exact:true}).inputValue(), '2.5');
  assert.equal(await dialog.getByLabel('Preço 3', {exact:true}).inputValue(), '12.9');
  assert.equal(await dialog.getByLabel('Remover produto 1', {exact:true}).count(), 0, 'Entrega original preservada');
  await dialog.getByLabel('Remover produto 3', {exact:true}).click();
  assert.equal(await dialog.getByLabel('Produto 3', {exact:true}).count(), 0);
  await selection.selectOption(catalog[0].key);
  await dialog.getByLabel('Quantidade a adicionar').fill('2.5');
  await dialog.getByRole('button', {name:'Incluir produto selecionado',exact:true}).click();
  await dialog.getByLabel('Buscar produto na tabela').fill('');
  assert.equal(await selection.locator('option').count(), 2, 'Produto adicionado deixa a lista');
  await selection.selectOption(catalog[1].key);
  await dialog.getByText('Este produto está sem preço cadastrado.', {exact:false}).waitFor();
  await dialog.getByRole('button', {name:'Incluir produto selecionado',exact:true}).click();
  assert.equal(await dialog.getByLabel('Preço 4', {exact:true}).inputValue(), '0');
  await dialog.getByLabel('Remover produto 4', {exact:true}).click();
  await page.screenshot({path:'tmp/igeve-billing-add-products.png',fullPage:true});
  await dialog.getByRole('button', {name:'Salvar faturamento',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  const stored = [...db.values()].filter(row => row.key.startsWith('gom_igeve_invoice_'));
  assert.equal(stored.length, 1);
  assert.equal(stored[0].value.items[2].quantity, 0);
  assert.equal(stored[0].value.items[2].billedQuantity, 2.5);
  assert.equal(stored[0].value.items[2].addedForBilling, true);
  assert.equal(stored[0].value.items[0].quantity, 1);
  await page.reload();
  await page.getByRole('button', {name:'Faturamento por operação/local',exact:true}).click();
  await page.locator('.igeve-category-filter summary').click();
  await page.getByRole('checkbox', {name:'Estocáveis',exact:true}).check();
  await page.locator('.igeve-category-filter summary').click();
  await page.getByRole('button', {name:'Editar faturamento',exact:true}).click();
  const savedCompany = `${billingCompanyName} — 11.222.333/0001-81`;
  assert.deepEqual(await dialog.locator('#igeve-companies option').evaluateAll(options => options.map(option => option.value)), [savedCompany]);
  await companyName.fill(savedCompany);
  assert.equal(await companyName.inputValue(), billingCompanyName);
  assert.equal(await companyCnpj.inputValue(), '11.222.333/0001-81');
  assert.equal(await dialog.getByLabel('Ajuste faturamento 3', {exact:true}).inputValue(), '2.5');
  assert.equal(await dialog.getByLabel('Preço 3', {exact:true}).inputValue(), '12.9');
  await dialog.getByLabel('Remover produto 3', {exact:true}).click();
  await dialog.getByRole('button', {name:'Salvar faturamento',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  assert.equal(db.get(stored[0].key).value.items.length, 2, 'Remoção persiste após reabrir');
  assert.deepEqual(errors, []);
  console.log('OK: cadastro, validação, duplicidade e reuso da empresa. Inclusão e gravação dos produtos no navegador.');
} finally { await browser.close(); }
