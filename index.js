
async function generateHMAC(message, secret) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(message);
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, messageData));
  return signature.toBase64().replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function verifyHMAC(message, signature, secret) {
  const encoder = new TextEncoder();
  const a = encoder.encode(signature);
  const b = encoder.encode(await generateHMAC(message, secret));
  return a.byteLength === b.byteLength && crypto.subtle.timingSafeEqual(a, b);
}

async function handleRegister(request, env) {
  const username = crypto.randomUUID();
  const password = await generateHMAC(username, env.HMAC_SECRET);
  const subdomain = username;
  const fulldomain = `${subdomain}.${env.DOMAIN_SUFFIX}`;

  console.log('handleRegister', { fulldomain });

  return new Response(JSON.stringify({
    username: username,
    password: password,
    fulldomain: fulldomain,
    subdomain: subdomain,
    allowfrom: ['0.0.0.0/0', '::/0'],
  }), {
    headers: { 'Content-Type': 'application/json' },
    status: 201
  });
}

async function handleUpdate(request, env) {
  const username = request.headers.get('X-Api-User');
  const password = request.headers.get('X-Api-Key');
  const body = await request.json().catch(() => ({}));

  if (!body.subdomain || !body.txt || !username || !password) {
    return new Response(JSON.stringify({
      error: 'bad request'
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 400
    });
  }

  if (username !== body.subdomain) {
    return new Response(JSON.stringify({
      error: 'bad request'
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 400
    });
  }

  const isValidPassword = await verifyHMAC(username, password, env.HMAC_SECRET);
  if (!isValidPassword) {
    return new Response(JSON.stringify({
      error: 'unauthorized'
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 401
    });
  }

  const recordName = `${body.subdomain}.${env.DOMAIN_SUFFIX}`;
  console.log('handleUpdate', { recordName, recordValue: body.txt });

  try {
    const createResponse = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'TXT',
          name: recordName,
          content: `"${body.txt}"`,
          ttl: 1, // automatic
        }),
      }
    );
    const createResult = await createResponse.json();
    console.log('create record', { recordName, createResult });

    if (createResult.success) {
      return new Response(JSON.stringify({
        txt: body.txt
      }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200
      });
    }

    // fallthrough
  } catch (error) {
    console.log('unexpected exception', { recordName, error: error.message });
  }

  return new Response(JSON.stringify({
    error: 'internal server error',
  }), {
    headers: { 'Content-Type': 'application/json' },
    status: 500
  });
}

async function listRecords(env) {
  try {
    const listResponse = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records?name.endswith=.${env.DOMAIN_SUFFIX}&type=TXT&order=name&per_page=3500`,
      {
        headers: {
          'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return (await listResponse.json()).result;
  } catch (error) {
    console.log('listRecords: exception', { error: error.message });
    return;
  }
}

async function cleanupStaleRecords(env) {
  const existingRecords = await listRecords(env);
  if (!existingRecords || existingRecords.length === 0) {
    return;
  }

  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const staleRecords = existingRecords.filter(record => new Date(record.created_on) < tenMinutesAgo);
  if (staleRecords.length === 0) {
    return;
  }

  console.log('cleanupStaleRecords: found stale records', { stale: staleRecords.length, total: existingRecords.length });

  await Promise.all(staleRecords.map(async (record) => {
    try {
      const deleteResponse = await fetch(
        `https://api.cloudflare.com/client/v4/zones/${env.CLOUDFLARE_ZONE_ID}/dns_records/${record.id}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
            'Content-Type': 'application/json',
          },
        }
      );
      const deleteResult = await deleteResponse.json();
      console.log('cleanupStaleRecords: delete record', { record, deleteResult });
    } catch (error) {
      console.log('cleanupStaleRecords: delete record exception', { record, error: error.message });
    }
  }));
}

export default {
  // eslint-disable-next-line no-unused-vars
  async scheduled(event, env, _ctx) {
    await cleanupStaleRecords(env);
  },

  // eslint-disable-next-line no-unused-vars
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'POST' && path === '/register') {
      return await handleRegister(request, env);
    }

    if (method === 'POST' && path === '/update') {
      return await handleUpdate(request, env);
    }

    return new Response(JSON.stringify({
      error: 'Not found'
    }), {
      headers: { 'Content-Type': 'application/json' },
      status: 404
    });
  },
};
