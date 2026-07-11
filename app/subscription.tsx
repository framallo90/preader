import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { Screen } from '../src/components/Screen';
import { useAppSettings } from '../src/hooks/useAppSettings';
import { authService } from '../src/services/authService';
import { premiumService, PremiumListener } from '../src/services/premiumService';
import { PERSONAL_MODE } from '../src/config/appMode';
import { supabase } from '../src/config/supabase';

type Plan = 'monthly' | 'yearly';

async function createPaymentPreference(planId: Plan): Promise<string> {
  const session = await authService.getSession();
  if (!session) throw new Error('Sesión no encontrada');

  const res = await supabase.functions.invoke('create-payment', {
    body: { planId },
  });

  if (res.error) throw new Error(res.error.message);
  const data = res.data as { checkoutUrl?: string; error?: string };
  if (!data.checkoutUrl) throw new Error(data.error ?? 'No se pudo crear el pago');
  return data.checkoutUrl;
}

export default function SubscriptionScreen() {
  const { colors } = useAppSettings();
  const [isPremium, setIsPremium] = useState(premiumService.isPremium);
  const [loading, setLoading] = useState<Plan | null>(null);

  useEffect(() => {
    const listener: PremiumListener = (premium) => { setIsPremium(premium); };
    const unsubscribe = premiumService.subscribe(listener);
    return unsubscribe;
  }, []);

  const handleSubscribe = async (plan: Plan) => {
    // En modo uso propio no hay pagos ni login (ya es premium).
    if (PERSONAL_MODE) return;
    // Sin cuenta: el pago necesita identidad — primero login.
    const session = await authService.getSession();
    if (!session) {
      router.push('/login');
      return;
    }

    setLoading(plan);
    try {
      const url = await createPaymentPreference(plan);
      await Linking.openURL(url);
    } catch (err) {
      Alert.alert(
        'No se pudo abrir el pago',
        err instanceof Error ? err.message : 'Intenta de nuevo en unos minutos.',
      );
    } finally {
      setLoading(null);
    }
  };

  if (isPremium) {
    return (
      <Screen colors={colors} scroll>
        <View style={[styles.premiumCard, { backgroundColor: colors.readerSurface, borderColor: colors.border }]}>
          <Text style={[styles.badge, { color: colors.primary }]}>✦ PREMIUM ACTIVO</Text>
          <Text style={[styles.title, { color: colors.text }]}>Gracias por apoyar el proyecto</Text>
          <Text style={[styles.body, { color: colors.textMuted }]}>
            Tenes acceso completo a voces de IA de OpenAI, extracción de contexto de capítulos con Claude y el chat companion.
          </Text>
          <TouchableOpacity
            style={[styles.secondaryBtn, { borderColor: colors.border }]}
            onPress={() => router.back()}
          >
            <Text style={[styles.secondaryLabel, { color: colors.text }]}>Volver</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  return (
    <Screen colors={colors} scroll>
      <View style={[styles.header, { borderColor: colors.border }]}>
        <Text style={[styles.eyebrow, { color: colors.primary }]}>intelliReader Premium</Text>
        <Text style={[styles.title, { color: colors.text }]}>Escucha mejor, lee más</Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          La versión gratuita ya incluye lectura de PDF, EPUB y DOCX con voz del sistema. Premium agrega las voces de IA más naturales y el análisis de capítulos.
        </Text>
      </View>

      <View style={styles.featureList}>
        {PREMIUM_FEATURES.map((f) => (
          <View key={f} style={styles.featureRow}>
            <Text style={{ color: colors.primary }}>✓</Text>
            <Text style={[styles.featureText, { color: colors.text }]}>{f}</Text>
          </View>
        ))}
      </View>

      <PlanCard
        plan="monthly"
        title="Mensual"
        price="$499 ARS / mes"
        loading={loading === 'monthly'}
        colors={colors}
        onPress={() => { void handleSubscribe('monthly'); }}
      />
      <PlanCard
        plan="yearly"
        title="Anual"
        price="$3.999 ARS / año"
        badge="Ahorrás 33%"
        loading={loading === 'yearly'}
        colors={colors}
        onPress={() => { void handleSubscribe('yearly'); }}
      />

      <Text style={[styles.disclaimer, { color: colors.textMuted }]}>
        El pago se procesa vía MercadoPago. Al completar el pago, Premium se activa automáticamente en esta app.
      </Text>
    </Screen>
  );
}

const PREMIUM_FEATURES = [
  'Voces de IA de OpenAI (onyx, nova, alloy, echo, fable, shimmer)',
  'Preprocesamiento de texto con Claude para TTS más natural',
  'Extracción de contexto de capítulos: resumen antes y después',
  'Chat companion con memoria de la saga',
];

function PlanCard({
  title,
  price,
  badge,
  loading,
  colors,
  onPress,
}: {
  plan: Plan;
  title: string;
  price: string;
  badge?: string;
  loading: boolean;
  colors: ReturnType<typeof useAppSettings>['colors'];
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.planCard, { backgroundColor: colors.surface, borderColor: colors.border }]}
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.85}
    >
      <View style={styles.planHeader}>
        <Text style={[styles.planTitle, { color: colors.text }]}>{title}</Text>
        {badge ? (
          <View style={[styles.planBadge, { backgroundColor: colors.primary }]}>
            <Text style={styles.planBadgeText}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.planPrice, { color: colors.text }]}>{price}</Text>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />
      ) : (
        <View style={[styles.planBtn, { backgroundColor: colors.primary }]}>
          <Text style={styles.planBtnLabel}>Suscribirme</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  header: { gap: 10, paddingBottom: 8 },
  eyebrow: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  title: { fontSize: 26, fontWeight: '800', lineHeight: 32 },
  body: { fontSize: 15, lineHeight: 22 },
  featureList: { gap: 10, marginBottom: 8 },
  featureRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  featureText: { flex: 1, fontSize: 15, lineHeight: 21 },
  planCard: { borderWidth: 1, borderRadius: 20, padding: 18, gap: 6 },
  planHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  planTitle: { fontSize: 18, fontWeight: '700' },
  planBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  planBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  planPrice: { fontSize: 15 },
  planBtn: { borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 6 },
  planBtnLabel: { color: '#fff', fontWeight: '700', fontSize: 16 },
  premiumCard: { borderWidth: 1, borderRadius: 24, padding: 20, gap: 12 },
  badge: { fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  secondaryBtn: { borderWidth: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  secondaryLabel: { fontSize: 16, fontWeight: '600' },
  disclaimer: { fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
