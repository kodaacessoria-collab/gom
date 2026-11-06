import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {unzipSync} from 'fflate';
// Requires Playwright and a local Vite server (default port 5174).
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
writeFileSync('tmp/igeve-documents-test.html', `<!doctype html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module">
import React from 'react';
import {createRoot} from 'react-dom/client';
import IgeveDocuments from '/src/components/IgeveDocuments.tsx';
import '/src/index.css';
import '/src/components/IgeveBilling.css';
createRoot(document.getElementById('root')).render(React.createElement('section', {className:'igeve-billing',style:{padding:'24px'}}, React.createElement(IgeveDocuments)));
</script></body></html>
`);
const browser = await chromium.launch({...(process.env.CHROME_EXECUTABLE_PATH ? {executablePath:process.env.CHROME_EXECUTABLE_PATH} : {}),headless:true,args:['--no-sandbox']});
try {
const page = await browser.newPage({viewport:{width:1440,height:1100}});
const errors=[]; page.on('pageerror', e=>errors.push(e.message));
const db=new Map(); let conflict=false;
await page.route('**/rest/v1/app_shared_state*', async route=>{
 const req=route.request(), url=new URL(req.url());
 if(req.method()==='GET') {
  const prefix=(url.searchParams.get('key')||'').replace(/^like\./,'').replace(/\\/g,'').replace(/%$/,'');
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([...db.values()].filter(r=>r.key.startsWith(prefix)).sort((a,b)=>a.key.localeCompare(b.key)))});
 }
 if(conflict) return route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({message:'Conflito simulado'})});
 const row=req.postDataJSON();
 if(req.method()==='PATCH') {
  const old=db.get(row.key), prev=url.searchParams.get('updated_at')?.replace(/^eq\./,'');
  if(!old || old.updated_at!==prev) return route.fulfill({status:406,contentType:'application/json',body:JSON.stringify({message:'Conflito'})});
 }
 db.set(row.key,row);
 return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({updated_at:row.updated_at})});
});
await page.goto(`${process.env.GOM_TEST_URL || 'http://127.0.0.1:5174'}/tmp/igeve-documents-test.html`);
await page.getByRole('heading',{name:'Orçamentos e entrega por NF-e'}).waitFor();
await page.getByLabel('Importar NF-e em PDF',{exact:true}).setInputFiles('tmp/pdfs/igeve-documents/nfe-fixture.pdf');
await page.getByText('PDF importado. Confira todos os campos e os itens com o original.').waitFor();
assert.equal(await page.getByLabel('Número da NF-e',{exact:true}).inputValue(),'000000658');
assert.equal(await page.getByLabel('CNPJ do destinatário',{exact:true}).inputValue(),'28.413.401/0041-80');
assert.equal(await page.locator('input[aria-label^="product item"]').count(),3);
assert.equal(await page.getByLabel('Quantidade item 1',{exact:true}).inputValue(),'3.00');
assert.equal(await page.getByLabel('Preço da NF-e item 2',{exact:true}).inputValue(),'4.50');
await page.getByLabel('Número da NF-e',{exact:true}).fill('658');
await page.getByLabel('Emitente da NF-e',{exact:true}).fill('CANINDÉ');
await page.getByLabel('Endereço de entrega',{exact:true}).fill('ENDEREÇO FICTÍCIO PARA TESTE');
// Shared CNPJ never chooses a school silently.
await page.getByLabel('CNPJ do destinatário',{exact:true}).fill('28.413.401/0050-70');
assert.equal(await page.getByLabel('Unidade / escola',{exact:false}).inputValue(),'');
assert.equal(await page.getByLabel('Unidade / escola',{exact:false}).locator('option').count(),4);
await page.getByLabel('CNPJ do destinatário',{exact:true}).fill('28.413.401/0041-80');
assert.equal(await page.getByLabel('Unidade / escola',{exact:false}).inputValue(),'igeve-unit-24');
for(const name of ['CANINDÉ DISTRIBUIDORA','RED SOLUÇÕES','GRANTERRA']) await page.locator('.igeve-document-suppliers label').filter({hasText:name}).locator('input').check();
const q=page.locator('.igeve-document-quote');
assert.equal(await q.nth(0).locator('input[type=number]').nth(0).inputValue(),'2.56');
assert.equal(await q.nth(1).locator('input[type=number]').nth(0).inputValue(),'2.78');
assert.equal(await q.nth(2).locator('input[type=number]').nth(0).inputValue(),'2.88');
await page.getByLabel('Preço da NF-e item 1',{exact:true}).fill('100');
await page.getByLabel('Preço da NF-e item 1',{exact:true}).blur();
assert.equal(await q.nth(0).locator('input[type=number]').nth(0).inputValue(),'100.00');
assert.equal(await q.nth(1).locator('input[type=number]').nth(0).inputValue(),'108.75');
assert.equal(await q.nth(2).locator('input[type=number]').nth(0).inputValue(),'112.35');
await q.nth(1).locator('input[type=number]').nth(0).fill('90');
await page.getByLabel('Preço da NF-e item 1',{exact:true}).fill('200');
await page.getByLabel('Preço da NF-e item 1',{exact:true}).blur();
assert.equal(await q.nth(1).locator('input[type=number]').nth(0).inputValue(),'90.00');
await q.nth(1).getByRole('button',{name:'Recalcular valores automaticamente'}).click();
assert.equal(await q.nth(1).locator('input[type=number]').nth(0).inputValue(),'217.50');
await page.getByLabel('Preço da NF-e item 1',{exact:true}).fill('2.56');
await page.getByLabel('Preço da NF-e item 1',{exact:true}).blur();
for(let i=0;i<3;i++) {
 await q.nth(i).getByLabel('Referência da cotação recebida').fill(`TESTE FICTÍCIO ${i}`);
 const values=i===0?[2.56,4.5,10]:i===1?[2,4,9]:[3,5,11];
 const inputs=q.nth(i).locator('input[type=number]');
 for(let j=0;j<3;j++) await inputs.nth(j).fill(String(values[j]));
}
await page.getByLabel('Conferi a NF-e, o CNPJ, a unidade, os itens e os valores informados.').check();
await page.getByRole('button',{name:'Salvar dados da NF-e',exact:true}).click();
await page.getByText('Dados da NF-e salvos.',{exact:true}).waitFor();
assert.equal(db.size,1);
assert.equal([...db.values()][0].value.document.quotations.length,3);
await q.nth(0).getByRole('button',{name:'Visualizar orçamento',exact:true}).click();
await page.getByRole('dialog').waitFor();
await page.getByRole('button',{name:'Fechar',exact:true}).click();
let download=page.waitForEvent('download');
await page.getByRole('button',{name:'Gerar orçamentos selecionados (ZIP com PDFs)',exact:true}).click();
let out=await download; await out.saveAs('tmp/pdfs/igeve-documents/browser-quotes.zip');
const data=await (await import('node:fs/promises')).readFile('tmp/pdfs/igeve-documents/browser-quotes.zip');
const files=unzipSync(data); assert.equal(Object.keys(files).length,3);
for(const [name,bytes] of Object.entries(files)) writeFileSync(`tmp/pdfs/igeve-documents/browser-${name}`,bytes);
await page.getByLabel('Data de entrega',{exact:true}).fill('2026-11-06');
await page.getByLabel('Conferi a NF-e, o CNPJ, a unidade, os itens e os valores informados.').check();
download=page.waitForEvent('download'); await page.getByRole('button',{name:'Gerar romaneio PDF',exact:true}).click(); out=await download; await out.saveAs('tmp/pdfs/igeve-documents/browser-delivery.pdf');
assert.equal([...db.values()][0].value.generatedKind,'delivery');
assert.equal([...db.values()][0].value.generatedDocument.deliveryDate,'2026-11-06');
await page.getByRole('button',{name:'Histórico',exact:true}).click();
await page.getByRole('button',{name:'Abrir',exact:true}).click();
assert.equal(await page.getByLabel('Número da NF-e',{exact:true}).inputValue(),'658');
// Optimistic save failures must not report success or overwrite the old document.
const old=[...db.values()][0].value.document.issuer;
await page.getByLabel('Emitente da NF-e',{exact:true}).fill('TESTE ALTERADO');
await page.getByLabel('Conferi a NF-e, o CNPJ, a unidade, os itens e os valores informados.').check();
conflict=true; await page.getByRole('button',{name:'Salvar dados da NF-e',exact:true}).click();
await page.getByText('Não foi possível salvar.',{exact:false}).waitFor();
assert.equal([...db.values()][0].value.document.issuer,old); conflict=false;
// Register a new supplier, edit a default unit, and confirm persistence after reload.
await page.getByRole('button',{name:'Empresas e modelos',exact:true}).click();
await page.getByRole('button',{name:'Nova empresa / modelo',exact:true}).click();
await page.getByLabel('Razão social / nome',{exact:true}).fill('EMPRESA DE TESTE');
await page.getByLabel('CNPJ',{exact:true}).fill('28.413.401/0041-80');
await page.getByRole('button',{name:'Salvar empresa e modelo',exact:true}).click();
await page.getByText('Empresa e modelo salvos.',{exact:true}).waitFor();
assert.equal([...db.keys()].filter(k=>k.startsWith('gom_igeve_supplier_')).length,1);
await page.getByRole('button',{name:'Unidades IGEVE',exact:true}).click();
await page.getByRole('row').filter({hasText:'GARÇA TORTA'}).getByRole('button',{name:'Editar',exact:true}).click();
await page.getByLabel('Endereço de entrega',{exact:true}).fill('ENDEREÇO TESTE CADASTRADO');
await page.getByRole('button',{name:'Salvar unidade',exact:true}).click(); await page.getByText('Unidade salva.',{exact:true}).waitFor();
page.on('dialog',dialog=>dialog.accept());
await page.reload(); await page.getByRole('button',{name:'Histórico',exact:true}).click();
assert.equal(await page.getByRole('button',{name:'Abrir',exact:true}).count(),1);
await page.getByRole('button',{name:'Baixar última geração',exact:true}).waitFor();
await page.getByRole('button',{name:'Abrir',exact:true}).click();
assert.equal(await page.getByLabel('Número da NF-e',{exact:true}).inputValue(),'658');
await page.setViewportSize({width:390,height:844});
await page.screenshot({path:'tmp/pdfs/igeve-documents/ui-mobile.png',fullPage:true});
assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
assert.deepEqual(errors,[]);
console.log('OK: navegador - PDF importado, escola por CNPJ, 2 casas, 3 cotações com preços independentes, ZIP/PDF, prévia, romaneio, histórico, conflito de gravação, cadastros e tela móvel.');
} finally { await browser.close(); }
