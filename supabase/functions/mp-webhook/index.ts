import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // MercadoPago manda IPN por query params y los webhooks nuevos por JSON body.
    const url = new URL(req.url);
    let topic = url.searchParams.get('topic') ?? url.searchParams.get('type');
    let id = url.searchParams.get('id') ?? url.searchParams.get('data.id');

    if (!topic || !id) {
      try {
        const body = await req.json();
        topic = topic ?? body?.type ?? body?.topic ?? null;
        id = id ?? body?.data?.id ?? null;
      } catch { /* sin body JSON */ }
    }

    // Solo procesamos pagos; con merchant_order el id no sirve para /v1/payments.
    if (topic !== 'payment' || !id) {
      return new Response('ok', { status: 200 });
    }

    // Fetch payment details from MercadoPago
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
      headers: { 'Authorization': `Bearer ${Deno.env.get('MP_ACCESS_TOKEN') ?? ''}` },
    });

    if (!mpRes.ok) {
      console.error('mp-webhook: could not fetch payment', id);
      return new Response('error', { status: 200 }); // always 200 to MP
    }

    const payment = await mpRes.json();

    if (payment.status !== 'approved') {
      return new Response('ok', { status: 200 });
    }

    // external_reference tiene formato "userId|planId" (ver create-payment).
    const [userId, planId = 'monthly'] = String(payment.external_reference ?? '').split('|');
    if (!userId) {
      console.error('mp-webhook: no external_reference in payment');
      return new Response('ok', { status: 200 });
    }

    // Validar que el monto pagado corresponde al plan (evita acreditar pagos truchos).
    const priceMap: Record<string, number> = { monthly: 499, yearly: 3999 };
    const expectedPrice = priceMap[planId] ?? priceMap['monthly'];
    if (typeof payment.transaction_amount === 'number' && payment.transaction_amount < expectedPrice) {
      console.error(`mp-webhook: amount ${payment.transaction_amount} < expected ${expectedPrice} for plan ${planId}`);
      return new Response('ok', { status: 200 });
    }

    // Activate premium using service role key (bypasses RLS)
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // Extiende desde el vencimiento vigente si todavía no expiró (renovaciones).
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('premium_until')
      .eq('id', userId)
      .single();

    const now = new Date();
    const base =
      existingProfile?.premium_until && new Date(existingProfile.premium_until) > now
        ? new Date(existingProfile.premium_until)
        : now;

    const monthsToAdd = planId === 'yearly' ? 12 : 1;
    const premiumUntil = new Date(base);
    premiumUntil.setMonth(premiumUntil.getMonth() + monthsToAdd);

    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ is_premium: true, premium_until: premiumUntil.toISOString() })
      .eq('id', userId);

    if (error) {
      console.error('mp-webhook: failed to update profile', error);
    } else {
      console.log(`mp-webhook: premium activated for user ${userId}`);
    }

    return new Response('ok', { status: 200 });
  } catch (err) {
    console.error('mp-webhook error:', err);
    return new Response('ok', { status: 200 }); // always 200 to MP
  }
});
