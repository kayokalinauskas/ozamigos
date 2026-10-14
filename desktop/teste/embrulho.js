// Abre o app para os testes sem tocar no Ozamigos de verdade de quem roda: pasta de dados temporária
// (o main.js fixa a pasta "Ozamigos Share") e outro AppUserModelID (senão o Windows mistura os dois apps).
const { app } = require('electron');

const DADOS = process.env.OZAMIGOS_TESTE_DADOS;
if (!DADOS) throw new Error('OZAMIGOS_TESTE_DADOS não definido: o teste usaria os dados do app de verdade');

const definirPasta = app.setPath.bind(app);
app.setPath = (nome, valor) => definirPasta(nome, nome === 'userData' ? DADOS : valor);
const definirId = app.setAppUserModelId.bind(app);
app.setAppUserModelId = () => definirId('dev.ozamigos.teste');

require('../main.js');
