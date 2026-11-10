import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/igeve-unified-test.html', `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module">
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
  await page.goto(`${process.env.GOM_TEST_URL || 'http://127.0.0.1:5174'}/tmp/igeve-unified-test.html`);
  const panel = page.locator('.igeve-panel').filter({has:page.getByRole('heading',{name:'Romaneios disponíveis',exact:true})});
  await panel.getByRole('button',{name:'Preparar faturamento unificado',exact:true}).first().waitFor();
  assert.equal(await panel.locator('tbody tr').count(), 2, 'Todas as categorias: um faturamento por local');
  const select = async names => {
    await page.locator('.igeve-category-filter summary').click();
    await page.getByRole('checkbox',{name:'Todas as categorias',exact:true}).check();
    for (const name of names) await page.getByRole('checkbox',{name,exact:true}).check();
    await page.locator('.igeve-category-filter summary').click();
  };
  await select(['Estocáveis']);
  assert.equal(await panel.getByRole('button',{name:'Preparar faturamento',exact:true}).count(), 2);
  await select(['Dietas e Fórmulas','Estocáveis']);
  assert.equal(await panel.getByRole('button',{name:'Preparar faturamento unificado',exact:true}).count(), 2);
  assert.equal(await panel.getByRole('button',{name:'Preparar faturamento',exact:true}).count(), 0);
  await panel.getByRole('button',{name:'Preparar faturamento unificado',exact:true}).first().click();
  const dialog = page.getByRole('dialog');
  assert.equal(await dialog.getByRole('textbox',{name:/^Produto \d/}).count(), 2, 'Dois produtos no mesmo editor; terceira categoria excluída');
  await dialog.getByLabel('Empresa para faturamento',{exact:true}).fill('Empresa Teste');
  await dialog.getByLabel('Preço 1',{exact:true}).fill('10');
  await dialog.getByLabel('Preço 2',{exact:true}).fill('20');
  await dialog.getByLabel('Ajuste faturamento 1',{exact:true}).fill('0.5');
  await dialog.getByLabel('Ajuste faturamento 2',{exact:true}).fill('0');
  assert.equal(await dialog.getByLabel('Categoria do romaneio de ajuste').locator('option').count(), 2);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  for (const [category, product, excluded, total] of [
    ['Dietas e Fórmulas', 'Produto 1', 'Produto 0', '0,00'],
    ['Estocáveis', 'Produto 0', 'Produto 1', '5,00'],
  ]) {
    await dialog.getByLabel('Categoria do romaneio de ajuste').selectOption(category);
    const downloaded = page.waitForEvent('download');
    await dialog.getByRole('button',{name:'Gerar romaneio de ajuste',exact:true}).click();
    const file = await downloaded;
    assert.ok(file.suggestedFilename().startsWith('romaneio-ajuste-'));
    const path = `tmp/ajuste-${category === 'Estocáveis' ? 'estocaveis' : 'dietas'}.pdf`;
    await file.saveAs(path);
    const { readFileSync } = await import('node:fs');
    const pdf = await getDocument({data: new Uint8Array(readFileSync(path)), useSystemFonts: true}).promise;
    let content = '';
    for (let i = 1; i <= pdf.numPages; i++) content += (await (await pdf.getPage(i)).getTextContent()).items.map(item => item.str).join(' ');
    assert.ok(content.includes('Romaneio de ajuste'), content);
    assert.ok(content.includes(category), content);
    assert.ok(content.includes(product), content);
    assert.ok(!content.includes(excluded), 'PDF não deve misturar produtos de outras categorias');
    assert.ok(content.includes(total), content);
  }
  assert.equal([...db.keys()].filter(key => key.startsWith('gom_igeve_invoice_')).length, 0, 'Gerar PDF não grava nem duplica faturamento');
  await page.screenshot({path:'tmp/igeve-ajuste-categoria.png', fullPage: true});
  await dialog.getByRole('button',{name:'Salvar faturamento',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  const saved = [...db.values()].filter(row => row.key.startsWith('gom_igeve_invoice_'));
  assert.equal(saved.length,1, 'Grava apenas um faturamento com as duas origens');
  assert.equal(saved[0].value.location.sourceIds.length,2);
  await page.getByRole('button',{name:'Faturamento por romaneio',exact:true}).click();
  await select(['Estocáveis','Dietas e Fórmulas']);
  await panel.getByRole('button',{name:'Abrir faturamento unificado',exact:true}).click();
  assert.equal(await dialog.getByLabel('Preço 1',{exact:true}).inputValue(),'10');
  assert.equal(await dialog.getByLabel('Preço 2',{exact:true}).inputValue(),'20');
  await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.reload();
  await panel.getByRole('button',{name:'Preparar faturamento unificado',exact:true}).first().waitFor();
  await select(['Dietas e Fórmulas','Estocáveis']);
  await panel.getByRole('button',{name:'Abrir faturamento unificado',exact:true}).click();
  assert.equal(await dialog.getByLabel('Empresa para faturamento',{exact:true}).inputValue(),'Empresa Teste');
  assert.deepEqual(errors,[]);
  console.log('OK: uma/várias/todas as categorias, separação por local, exclusão da terceira categoria, gravação única e reabertura após inverter seleção e recarregar.');
} finally { await browser.close(); }
