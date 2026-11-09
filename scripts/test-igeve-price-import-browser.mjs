import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/igeve-price-import-test.html', `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
import React from 'react'; import {createRoot} from 'react-dom/client';
import IgeveBilling from '/src/components/IgeveBilling.tsx'; import '/src/index.css';
createRoot(document.getElementById('root')).render(React.createElement(IgeveBilling));
</script></body></html>`);
const operation = { id: 'guaianases', name: 'Operação Guaianases (SP)', city: 'Guaianases' };
const points = ['Rubi', 'Mendonça'].map((name, i) => ({ id: `point-${i}`, name, operationId: operation.id }));
const month = new Intl.DateTimeFormat('sv-SE', {timeZone:'America/Sao_Paulo'}).format(new Date()).slice(0,7);
const orders = ['Estocáveis', 'Dietas e Fórmulas', 'Proteínas'].map((category, i) => ({
  id: `order-${i}`, operationId: operation.id, category, deliveryDate: `${month}-01`, importedAt: `2026-10-30T13:2${i}:00Z`,
  deliveries: points.map(point => ({ id: `${i}-${point.id}`, deliveryPointId: point.id, items: [{ product: `Produto ${i}`, unit: 'UN', quantity: i + 1 }] })),
}));
const db = new Map([
  ['gom_delivery_operations', [operation]], ['gom_delivery_points', points], ['gom_delivery_operation_orders', orders],
].map(([key, value]) => [key, {key, value, updated_at:'2026-11-01T00:00:00Z'}]));
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
  await page.goto(`${process.env.GOM_TEST_URL || 'http://127.0.0.1:5174'}/tmp/igeve-price-import-test.html`);
  await page.getByRole('button', {name:'Tabela de preços',exact:true}).click();
  const file = page.getByLabel('PDF para preços de venda');
  assert.equal(await file.isDisabled(),true);
  await page.getByLabel('Operação da tabela de destino').selectOption(operation.id);
  await page.getByLabel('Categoria da tabela de destino').selectOption('Proteínas');
  await file.setInputFiles('tmp/pdfs/igeve-documents/nfe-fixture.pdf');
  await page.getByLabel('Preço importado ARROZ PARBOLIZADO 1KG').waitFor();
  assert.equal(await page.getByLabel('Preço importado ARROZ PARBOLIZADO 1KG').inputValue(),'2.56');
  const apply = page.getByRole('button',{name:'Aplicar à tabela para revisão'});
  assert.equal(await apply.isDisabled(),true);
  await page.getByRole('checkbox',{name:/Conferi o PDF/}).check();
  await apply.click();
  assert.equal([...db.values()].filter(row=>row.key.startsWith('gom_igeve_price_')).length,0,'Revisão não grava');
  await page.getByRole('button',{name:/Salvar preços/}).click();
  await page.getByText('3 preço(s) salvo(s) com sucesso.',{exact:false}).waitFor();
  const prices = [...db.values()].filter(row=>row.key.startsWith('gom_igeve_price_'));
  assert.equal(prices.length,3);
  assert.ok(prices.every(row=>row.value.operationId===operation.id && row.value.category==='Proteínas' && row.value.source.filename==='nfe-fixture.pdf' && row.value.source.hash.length===64));
  await page.reload();
  await page.getByRole('button', {name:'Tabela de preços',exact:true}).click();
  await page.getByText('nfe-fixture.pdf | NF-e', {exact:false}).first().waitFor();
  // Same note maps to saved products; a repeated import can be cancelled without writes.
  await page.getByLabel('Operação da tabela de destino').selectOption(operation.id);
  await page.getByLabel('Categoria da tabela de destino').selectOption('Proteínas');
  await file.setInputFiles('tmp/pdfs/igeve-documents/nfe-fixture.pdf');
  await page.getByLabel('Preço importado ARROZ PARBOILIZADO 1KG').count();
  const dest = page.getByLabel('Destino ARROZ PARBOLIZADO 1KG'); await dest.waitFor();
  assert.notEqual(await dest.inputValue(),'new');
  await page.getByRole('checkbox',{name:/Conferi o PDF/}).check(); await apply.click();
  await page.getByRole('button',{name:'Cancelar alterações',exact:true}).click();
  assert.equal([...db.values()].filter(row=>row.key.startsWith('gom_igeve_price_')).length,3);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:'tmp/price-import-verified.png',fullPage:true});
  console.log('OK: PDF, tabela obrigatória, revisão, gravação, origem persistida, associação e cancelamento.');
} finally { await browser.close(); }
