exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { erro: 'Use POST.' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return json(500, { erro: 'OPENAI_API_KEY não configurada no Netlify.' });
  }

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { erro: 'JSON inválido.' });
  }

  const tipo = body.tipo || 'analise';
  const pergunta = body.pergunta || '';
  const dados = body.dados || {};

  const objetivos = {
    analise: 'Faça um diagnóstico completo do mês atual, mostrando saúde financeira, principais problemas, onde há duplicidade, onde cortar e plano de ação imediato.',
    dividas: 'Explique como sair das dívidas e reduzir juros sem quebrar o caixa do mês. Priorize ações práticas.',
    prioridade: 'Diga qual dívida, acionista ou parcela deve ser priorizada primeiro, considerando juros, impacto mensal e risco de atraso.',
    projecao: 'Faça uma projeção simples para 12 meses, explicando cenários conservador, realista e agressivo.',
    pergunta: pergunta || 'Responda a pergunta do usuário com base nos dados financeiros.'
  };

  const system = `Você é um consultor financeiro pessoal dentro de um sistema de Planejamento Financeiro Familiar.
Fale em português do Brasil, de forma direta, prática e fácil de entender.
Use valores em reais quando mencionar dinheiro.
Não invente dados. Se algo parecer duplicado, diga que precisa confirmar.
Dê prioridade para caixa, redução de juros, acionistas, dívidas e gastos que estouraram limites.
Sempre entregue: 1) resumo, 2) principais problemas, 3) plano de ação, 4) nota de 0 a 10.`;

  const user = `${objetivos[tipo] || objetivos.analise}

Dados financeiros em JSON:
${JSON.stringify(dados, null, 2)}`;

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        temperature: 0.2,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return json(response.status, { erro: data.error?.message || 'Erro na OpenAI.' });
    }

    const resultado = data.choices?.[0]?.message?.content || 'A IA não retornou texto.';
    return json(200, { resultado });
  } catch (e) {
    return json(500, { erro: e.message || 'Erro inesperado ao chamar a OpenAI.' });
  }
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(obj)
  };
}
