const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// Template for Products
const productData = [
  {
    PRODUTO: 'Arroz 5kg',
    CATEGORIA: 'Estocáveis',
    UND: 'UN',
    MARCA: 'Tio João',
    QTD: 10,
    MINIMO: 5
  },
  {
    PRODUTO: 'Feijão 1kg',
    CATEGORIA: 'Estocáveis',
    UND: 'UN',
    MARCA: 'Camil',
    QTD: 20,
    MINIMO: 10
  }
];

// Template for Slips (Romaneios)
const slipData = [
  {
    tipo: 'SAIDA',
    Depósito: 'Depósito-Grupo OM',
    produto: 'Arroz 5kg',
    und: 'UN',
    qtd: 5,
    Municipio: 'Cozinha Central',
    data: new Date().toISOString().split('T')[0]
  },
  {
    tipo: 'SAIDA',
    Depósito: 'Depósito-Grupo OM',
    produto: 'Feijão 1kg',
    und: 'UN',
    qtd: 10,
    Municipio: 'Doação',
    data: new Date().toISOString().split('T')[0]
  }
];

const wb = XLSX.utils.book_new();

// Sheet 1: Produtos
const wsProducts = XLSX.utils.json_to_sheet(productData);
XLSX.utils.book_append_sheet(wb, wsProducts, 'Produtos');

// Sheet 2: Romaneios
const wsSlips = XLSX.utils.json_to_sheet(slipData);
XLSX.utils.book_append_sheet(wb, wsSlips, 'Romaneios');

const outputPath = path.join(process.cwd(), 'Modelo_Importacao_GOM.xlsx');
XLSX.writeFile(wb, outputPath);

console.log('Template criado com sucesso em: ' + outputPath);
