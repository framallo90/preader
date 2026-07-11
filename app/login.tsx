import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { AppButton } from '../src/components/AppButton';
import { useAppSettings } from '../src/hooks/useAppSettings';
import { authService } from '../src/services/authService';
import { PERSONAL_MODE } from '../src/config/appMode';

type Mode = 'login' | 'register' | 'reset';

export default function LoginScreen() {
  const { colors } = useAppSettings();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Modo uso propio: no hay cuentas ni login. Si algo cae en /login
  // (deep link, estado de navegación restaurado, etc.), se vuelve a Home.
  if (PERSONAL_MODE) {
    return <Redirect href="/" />;
  }

  const handleSubmit = async () => {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) { Alert.alert('Ingresa tu email.'); return; }

    if (mode === 'reset') {
      setIsLoading(true);
      const error = await authService.resetPassword(trimmedEmail);
      setIsLoading(false);
      if (error) { Alert.alert('Error', error.message); return; }
      Alert.alert('Listo', 'Te enviamos un email para recuperar tu contraseña.');
      setMode('login');
      return;
    }

    if (password.length < 6) { Alert.alert('La contraseña debe tener al menos 6 caracteres.'); return; }

    setIsLoading(true);
    const error =
      mode === 'login'
        ? await authService.signIn(trimmedEmail, password)
        : await authService.signUp(trimmedEmail, password);
    setIsLoading(false);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    if (mode === 'register') {
      Alert.alert(
        'Cuenta creada',
        'Revisá tu email para confirmar la cuenta antes de ingresar.',
      );
      setMode('login');
    }
    // Si el login fue exitoso, _layout.tsx detecta la sesión y redirige automáticamente
  };

  const title = mode === 'login' ? 'Ingresar' : mode === 'register' ? 'Crear cuenta' : 'Recuperar contraseña';
  const buttonLabel = isLoading ? 'Cargando...' : title;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={[styles.appName, { color: colors.primary }]}>intelliReader</Text>
          <Text style={[styles.tagline, { color: colors.textMuted }]}>
            Lector personal con IA
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>

          <View style={styles.field}>
            <Text style={[styles.label, { color: colors.textMuted }]}>Email</Text>
            <TextInput
              style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.border, color: colors.text }]}
              placeholder="tu@email.com"
              placeholderTextColor={colors.textMuted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          {mode !== 'reset' ? (
            <View style={styles.field}>
              <Text style={[styles.label, { color: colors.textMuted }]}>Contraseña</Text>
              <TextInput
                style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.border, color: colors.text }]}
                placeholder="••••••"
                placeholderTextColor={colors.textMuted}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
            </View>
          ) : null}

          <AppButton
            label={buttonLabel}
            onPress={() => { void handleSubmit(); }}
            colors={colors}
            fullWidth
            disabled={isLoading}
            style={{ marginTop: 8 }}
          />
        </View>

        <View style={styles.links}>
          {mode === 'login' ? (
            <>
              <TouchableOpacity onPress={() => setMode('register')}>
                <Text style={[styles.link, { color: colors.primary }]}>Crear cuenta gratis</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setMode('reset')}>
                <Text style={[styles.link, { color: colors.textMuted }]}>Olvidé mi contraseña</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.replace('/')}>
                <Text style={[styles.link, { color: colors.textMuted }]}>Continuar sin cuenta →</Text>
              </TouchableOpacity>
            </>
          ) : (
            <TouchableOpacity onPress={() => setMode('login')}>
              <Text style={[styles.link, { color: colors.primary }]}>← Volver a ingresar</Text>
            </TouchableOpacity>
          )}
        </View>

        <View style={[styles.freeTierNote, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
          <Text style={[styles.freeTierTitle, { color: colors.text }]}>Gratis para siempre</Text>
          <Text style={[styles.freeTierBody, { color: colors.textMuted }]}>
            La cuenta gratuita incluye lectura de PDF, EPUB, TXT y DOCX con voz del sistema, progreso guardado y navegación por capítulos.{'\n'}
            Premium agrega voces naturales OpenAI, resúmenes de capítulos con IA y chat companion.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 20, gap: 20 },
  header: { alignItems: 'center', gap: 6 },
  appName: { fontSize: 32, fontWeight: '800' },
  tagline: { fontSize: 15 },
  card: { borderWidth: 1, borderRadius: 24, padding: 20, gap: 14 },
  title: { fontSize: 22, fontWeight: '700' },
  field: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  links: { alignItems: 'center', gap: 12 },
  link: { fontSize: 15, fontWeight: '600' },
  freeTierNote: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 6 },
  freeTierTitle: { fontSize: 14, fontWeight: '700' },
  freeTierBody: { fontSize: 13, lineHeight: 19 },
});
