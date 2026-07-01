const crypto = require('crypto');

const EDUZZ_API_KEY = process.env.EDUZZ_API_KEY || '';
const NOTIFICATION_WEBHOOK_URL = process.env.NOTIFICATION_WEBHOOK_URL || '';

const STATUS = {
  1: 'pending',
  2: 'open',
  3: 'approved',
  4: 'cancelled',
  5: 'chargeback',
  6: 'blocked',
  7: 'refunded',
};

function verificarAssinatura(body) {
  if (!EDUZZ_API_KEY) return true;
  const expected = crypto
    .createHash('md5')
    .update(EDUZZ_API_KEY + (body.trans_cod || ''))
    .digest('hex');
  return body.key === expected;
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const ct = (req.headers['content-type'] || '').toLowerCase();
      try {
        if (ct.includes('application/json')) {
          resolve(JSON.parse(raw || '{}'));
        } else {
          const params = new URLSearchParams(raw);
          const obj = {};
          for (const [k, v] of params.entries()) obj[k] = v;
          resolve(obj);
        }
      } catch {
        resolve({});
      }
    });
    req.on('error', reject);
  });
}

async function notificar(registro) {
  if (!NOTIFICATION_WEBHOOK_URL) return;
  try {
    await fetch(NOTIFICATION_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(registro),
    });
  } catch (err) {
    console.error('[Eduzz] Falha ao notificar webhook externo:', err.message);
  }
}

module.exports = async function handler(req, res) {
  // GET: validação de endpoint pela Eduzz
  if (req.method === 'GET') {
    return res.status(200).send('OK');
  }

  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const body = await parseBody(req);

    if (!verificarAssinatura(body)) {
      console.warn('[Eduzz] Assinatura inválida:', JSON.stringify({ key: body.key, trans_cod: body.trans_cod }));
      return res.status(401).send('Unauthorized');
    }

    const statusCode = parseInt(body.trans_status || body.status || 0, 10);
    const registro = {
      recebido_em: new Date().toISOString(),
      trans_cod: body.trans_cod || null,
      status_codigo: statusCode,
      status: STATUS[statusCode] || 'unknown',
      produto_cod: body.product_cod || null,
      produto_nome: body.product_name || null,
      cliente_nome: body.customer_name || null,
      cliente_email: body.customer_email || null,
      cliente_documento: body.customer_document || null,
      metodo_pagamento: body.payment_method || null,
      valor: body.trans_value || body.value || null,
      moeda: body.currency || 'BRL',
      afiliado_email: body.affiliate_email || null,
    };

    console.log('[Eduzz] Compra recebida:', JSON.stringify(registro));

    await notificar(registro);

    return res.status(200).send('OK');
  } catch (err) {
    console.error('[Eduzz] Erro:', err.message);
    return res.status(500).send('Internal Server Error');
  }
};
