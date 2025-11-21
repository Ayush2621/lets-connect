// api/send-push.js
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

export const config = {
  runtime: "nodejs"
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE;

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false }
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const body = await req.json();
    const { toUserId, title, message } = body;

    if (!toUserId) {
      return res.status(400).json({ error: "toUserId required" });
    }

    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("*")
      .eq("user_id", toUserId);

    if (!subs || subs.length === 0) {
      return res.status(200).json({ sent: 0 });
    }

    const payload = JSON.stringify({
      title,
      body: message,
      data: { url: "/" }
    });

    let count = 0;

    for (const s of subs) {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: {
              p256dh: s.p256dh,
              auth: s.auth
            }
          },
          payload
        );
        count++;
      } catch (e) {
        console.warn("push error", e);
      }
    }

    return res.status(200).json({ sent: count });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
