// api/signed-url.js
// CommonJS export to avoid ESM pitfalls on Vercel (Node 18 runtime recommended)
module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed. Use GET.' });

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
      return res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE env variables.' });
    }

    const { bucket, path, expires = '3600' } = req.query;
    if (!bucket || !path) {
      return res.status(400).json({ error: 'Missing query parameters. Provide bucket and path.' });
    }

    // Require an Authorization header (Bearer <access_token>) to prevent open access.
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
    }
    const clientToken = authHeader.split(' ')[1];

    // dynamic import to avoid module type problems
    const { createClient } = await import('@supabase/supabase-js');

    // create a client using the service role (server-side secret)
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE, { auth: { persistSession: false } });

    // verify the provided token is a valid user token (optional but recommended)
    // this prevents anonymous callers from using your signed-url endpoint
    const { data: userData, error: userErr } = await sb.auth.getUser(clientToken);
    if (userErr || !userData || !userData.user) {
      return res.status(401).json({ error: 'Invalid user token.' });
    }

    // clamp ttl: min 60s, max 24h
    let ttl = parseInt(String(expires), 10) || 3600;
    if (isNaN(ttl)) ttl = 3600;
    ttl = Math.max(60, Math.min(24 * 3600, ttl));

    // create signed url
    const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, ttl);
    if (error) {
      console.error('createSignedUrl error', error);
      return res.status(500).json({ error: error.message || error });
    }

    // return both signedUrl and publicUrl (publicUrl useful if bucket is public)
    return res.status(200).json({ signedUrl: data?.signedUrl || null, publicUrl: data?.publicUrl || null });
  } catch (err) {
    console.error('signed-url handler error', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
};
<<<<<<< HEAD
=======

>>>>>>> 472713a9d1c5777dc29bb889833e3d1a948c8968
