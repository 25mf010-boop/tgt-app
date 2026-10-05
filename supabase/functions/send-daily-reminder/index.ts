// Supabase Edge Function for Daily 20:00 Web Push Reminder
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// VAPID キーペア (アプリフロントエンドと完全一致)
const VAPID_PUBLIC_KEY = "BIA1Xa0r-kMB5LO_krJFncggRLtBr8-YcSLzx5mF8lWUPh4dpDyac7yM2_6sBcOmALl_-ahKk_2yMAGBHusNGt0";
const VAPID_PRIVATE_KEY = "Ya5WsafhXTZ6WSWUdHXiJFQHtOjyDdvb-9J67tFZRQs";
const VAPID_SUBJECT = "mailto:tgt-research@example.com";

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

serve(async (req: Request) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 今日（YYYY-MM-DD）の日付を取得
    const today = new Date();
    const todayStr = today.toISOString().split("T")[0];

    // 本日の記録がすでにあるユーザー一覧を取得
    const { data: todayRecords } = await supabase
      .from("records")
      .select("user_id")
      .eq("date", todayStr);

    const completedUserIds = new Set((todayRecords || []).map((r: any) => String(r.user_id).toLowerCase()));

    // 登録済みの全 Push サブスクリプションを取得
    const { data: subscriptions, error: subError } = await supabase
      .from("push_subscriptions")
      .select("*");

    if (subError) throw subError;

    let sentCount = 0;
    let skippedCount = 0;

    for (const subItem of (subscriptions || [])) {
      const userId = String(subItem.user_id).toLowerCase();

      // すでに本日の記録が完了しているユーザーには通知を送らない
      if (completedUserIds.has(userId)) {
        skippedCount++;
        continue;
      }

      const pushSub = typeof subItem.subscription === "string" 
        ? JSON.parse(subItem.subscription) 
        : subItem.subscription;

      const payload = JSON.stringify({
        title: "【今日の記録】リマインダー",
        body: "今日の良かったこと3つを振り返って記録しましょう！🌿",
        url: "/"
      });

      try {
        await webpush.sendNotification(pushSub, payload);
        sentCount++;
      } catch (err) {
        console.warn(`Push send failed for ${userId}:`, err);
      }
    }

    return new Response(
      JSON.stringify({ success: true, sentCount, skippedCount }),
      { headers: { "Content-Type": "application/json" }, status: 200 }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      headers: { "Content-Type": "application/json" },
      status: 500
    });
  }
});
