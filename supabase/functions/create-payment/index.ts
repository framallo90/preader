import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { planId = 'monthly' } = await req.json();

    const priceMap: Record<string, number> = {
      monthly: 499,   // ARS
      yearly: 3999,
    };
    const price = priceMap[planId] ?? priceMap['monthly'];

    // Create MercadoPago preference
    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${Deno.env.get('MP_ACCESS_TOKEN') ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: [{
          id: planId,
          title: planId === 'yearly' ? 'intelliReader Premium — Anual' : 'intelliReader Premium — Mensual',
          quantity: 1,
          currency_id: 'ARS',
          unit_price: price,
        }],
        payer: { email: user.email },
        // Formato "userId|planId" para que el webhook sepa qué plan acreditar.
        external_reference: `${user.id}|${planId}`,
        notification_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/mp-webhook`,
        // Debe coincidir con el "scheme" de app.json ("intelli-reader").
        back_urls: {
          success: 'intelli-reader://payment/success',
          failure: 'intelli-reader://payment/failure',
          pending: 'intelli-reader://payment/pending',
        },
        auto_return: 'approved',
      }),
    });

    if (!mpResponse.ok) {
      const err = await mpResponse.text();
      return new Response(JSON.stringify({ error: err }), {
        status: mpResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const preference = await mpResponse.json();
    return new Response(JSON.stringify({ checkoutUrl: preference.init_point, preferenceId: preference.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('create-payment fn error:', err);
    return new Response(JSON.stringify({ error: 'Error interno del servidor' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
