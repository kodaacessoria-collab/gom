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
const points = ['Rubi', 'Mendonça'].map((name, i) => ({ id: `point-${i}`, name, operationId: operation.id, code: `1${i ? 'B' : 'A'}`, address: 'Rua de teste, 38', neighborhood: 'Jardim Mirian' }));
const month = new Intl.DateTimeFormat('sv-SE', {timeZone:'America/Sao_Paulo'}).format(new Date()).slice(0,7);
const orders = ['Estocáveis', 'Dietas e Fórmulas', 'Proteínas'].map((category, i) => ({
  id: `order-${i}`, operationId: operation.id, category, deliveryDate: `${month}-01`, importedAt: `2026-10-30T13:2${i}:00Z`,
  deliveries: points.map(point => ({ id: `${i}-${point.id}`, deliveryPointId: point.id, items: [{ product: `Produto ${i}`, unit: 'UN', quantity: i + 1 }, ...(i === 0 ? [{product: 'Sem ajuste', unit:'KG', quantity:4}] : [])] })),
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
  assert.equal(await dialog.getByRole('textbox',{name:/^Produto \d/}).count(), 3, 'Três produtos no mesmo editor; terceira categoria excluída');
  await dialog.getByLabel('Empresa para faturamento',{exact:true}).fill('OM LOGISTICA E DISTRIBUICAO LTDA');
  await dialog.getByLabel('CNPJ',{exact:true}).fill('68.673.515/0001-96');
  await dialog.getByLabel('Preço 1',{exact:true}).fill('10');
  await dialog.getByLabel('Preço 2',{exact:true}).fill('20');
  const adjustment1 = dialog.getByLabel('Ajuste faturamento 1',{exact:true});
  const adjustment2 = dialog.getByLabel('Ajuste faturamento 2',{exact:true});
  assert.equal(await adjustment1.inputValue(), '', 'Ajuste começa vazio');
  assert.equal(await adjustment2.inputValue(), '', 'Todas as linhas começam sem ajuste');
  await adjustment1.fill('+10');
  assert.ok((await adjustment1.locator('..').innerText()).includes('Qtd. faturada: 11'));
  await adjustment1.fill('');
  assert.ok((await adjustment1.locator('..').innerText()).includes('Qtd. faturada: 1'), 'Vazio mantém entrega');
  await adjustment1.fill('0');
  assert.ok((await adjustment1.locator('..').innerText()).includes('Qtd. faturada: 1'), 'Zero não zera faturamento');
  await adjustment1.fill('-10');
  assert.ok(await dialog.getByRole('alert').filter({hasText:'quantidade faturada negativa'}).count());
  await adjustment1.fill('-0.5');
  await adjustment2.fill('-2');
  assert.equal(await dialog.getByLabel('Categoria do romaneio').locator('option').count(), 2);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  for (const [category, product, excluded, quantity] of [
    ['Dietas e Fórmulas', 'Produto 1', 'Produto 0', '-2'],
    ['Estocáveis', 'Produto 0', 'Produto 1', '-0,5'],
  ]) {
    await dialog.getByLabel('Categoria do romaneio').selectOption(category);
    const downloaded = page.waitForEvent('download');
    await dialog.getByRole('button',{name:'Gerar romaneio',exact:true}).click();
    const file = await downloaded;
    assert.ok(file.suggestedFilename().startsWith('romaneio-') && !file.suggestedFilename().includes('ajuste'));
    const path = `tmp/ajuste-${category === 'Estocáveis' ? 'estocaveis' : 'dietas'}.pdf`;
    await file.saveAs(path);
    const { readFileSync } = await import('node:fs');
    const pdf = await getDocument({data: new Uint8Array(readFileSync(path)), useSystemFonts: true}).promise;
    let content = '';
    for (let i = 1; i <= pdf.numPages; i++) content += (await (await pdf.getPage(i)).getTextContent()).items.map(item => item.str).join(' ');
    content = content.replace(/\s+/g, ' ');
    assert.ok(content.includes('ROMANEIO') && !content.includes('ajuste'), content);
    assert.ok(content.includes(category.toUpperCase()), content);
    assert.ok(content.includes(product), content);
    assert.ok(!content.includes(excluded), 'PDF não deve misturar produtos de outras categorias');
    assert.ok(content.includes(quantity), content);
    assert.ok(!content.includes('Sem ajuste'), 'Exclui produto não ajustado da mesma categoria');
    assert.ok(!content.includes('R$'), 'Modelo OM Log sem valores financeiros');
    assert.ok(content.includes('Nome de quem recebeu'), content);
    assert.ok(content.includes('Rua de teste, 38'), content);
    assert.ok(content.includes('UND / MEDIDA'), content);
  }
  await adjustment1.fill('');
  await dialog.getByRole('button',{name:'Gerar romaneio',exact:true}).click();
  assert.ok(await dialog.getByRole('alert').filter({hasText:'Nenhum item ajustado nesta categoria'}).count());
  await adjustment1.fill('-0.5');
  await dialog.getByLabel('Empresa para faturamento',{exact:true}).fill('Outra empresa');
  await dialog.getByLabel('CNPJ',{exact:true}).fill('12.345.678/0001-90');
  const genericDownload = page.waitForEvent('download');
  await dialog.getByRole('button',{name:'Gerar romaneio',exact:true}).click();
  const genericFile = await genericDownload;
  await genericFile.saveAs('tmp/romaneio-outra-empresa.pdf');
  const { readFileSync: readGeneric } = await import('node:fs');
  const genericPdf = await getDocument({data:new Uint8Array(readGeneric('tmp/romaneio-outra-empresa.pdf')),useSystemFonts:true}).promise;
  const genericText = (await (await genericPdf.getPage(1)).getTextContent()).items.map(item => item.str).join(' ').replace(/\s+/g,' ');
  assert.ok(genericText.includes('R$'), 'Outras empresas preservam seu modelo atual');
  assert.ok(!genericText.includes('UND / MEDIDA'), 'Modelo OM não é usado em outras empresas');
  assert.ok(!genericText.includes('Sem ajuste'), 'Outras empresas também exportam somente itens ajustados');
  await dialog.getByLabel('Empresa para faturamento',{exact:true}).fill('OM LOGISTICA E DISTRIBUICAO LTDA');
  await dialog.getByLabel('CNPJ',{exact:true}).fill('68.673.515/0001-96');
  assert.equal([...db.keys()].filter(key => key.startsWith('gom_igeve_invoice_')).length, 0, 'Gerar PDF não grava nem duplica faturamento');
  await page.screenshot({path:'tmp/igeve-ajuste-categoria.png', fullPage: true});
  await dialog.getByRole('button',{name:'Salvar faturamento',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  const saved = [...db.values()].filter(row => row.key.startsWith('gom_igeve_invoice_'));
  assert.equal(saved.length,1, 'Grava apenas um faturamento com as duas origens');
  assert.equal(saved[0].value.location.sourceIds.length,2);
  assert.deepEqual(saved[0].value.items.map(item => item.billedQuantity), [.5, 0, 4]);
  assert.deepEqual(saved[0].value.items.map(item => item.quantity), [1, 2, 4]);
  await page.getByRole('button',{name:'Faturamento por romaneio',exact:true}).click();
  await select(['Estocáveis','Dietas e Fórmulas']);
  await panel.getByRole('button',{name:'Abrir faturamento unificado',exact:true}).click();
  assert.equal(await dialog.getByLabel('Ajuste faturamento 1',{exact:true}).inputValue(),'-0.5');
  assert.equal(await dialog.getByLabel('Ajuste faturamento 2',{exact:true}).inputValue(),'-2');
  assert.equal(await dialog.getByLabel('Preço 1',{exact:true}).inputValue(),'10');
  assert.equal(await dialog.getByLabel('Preço 2',{exact:true}).inputValue(),'20');
  await dialog.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.reload();
  await panel.getByRole('button',{name:'Preparar faturamento unificado',exact:true}).first().waitFor();
  await select(['Dietas e Fórmulas','Estocáveis']);
  await panel.getByRole('button',{name:'Abrir faturamento unificado',exact:true}).click();
  assert.equal(await dialog.getByLabel('Empresa para faturamento',{exact:true}).inputValue(),'OM LOGISTICA E DISTRIBUICAO LTDA');
  assert.equal(await dialog.getByLabel('Ajuste faturamento 1',{exact:true}).inputValue(),'-0.5');
  assert.equal(await dialog.getByLabel('Ajuste faturamento 2',{exact:true}).inputValue(),'-2');
  assert.deepEqual(errors,[]);
  console.log('OK: uma/várias/todas as categorias, separação por local, exclusão da terceira categoria, gravação única e reabertura após inverter seleção e recarregar.');
} finally { await browser.close(); }
