# Supabase Setup

Pasos para configurar el backend de intelliReader desde cero.

## 1. Crear proyecto en Supabase

1. Ir a [supabase.com](https://supabase.com) → New Project
2. Elegir nombre, región (América del Sur si está disponible) y contraseña de DB
3. Esperar a que el proyecto termine de provisionar (~2 min)

## 2. Ejecutar el schema SQL

1. En el dashboard: **SQL Editor → New query**
2. Pegar el contenido de `supabase/schema.sql` y ejecutar
3. Verificar que la tabla `profiles` aparece en **Table Editor**

## 3. Habilitar Realtime en profiles

En **SQL Editor**, ejecutar:
```sql
alter publication supabase_realtime add table public.profiles;
```

Esto permite que `premiumService` detecte la activación de Premium sin que el usuario tenga que cerrar y reabrir la app.

## 4. Configurar credenciales en la app

Crear `src/config/supabase.ts` ya existe — editar los placeholders:

```typescript
export const SUPABASE_URL = 'https://TU_PROJECT_ID.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJ...';  // Settings → API → anon key
```

Encontrás ambos valores en: **Project Settings → API**.

## 5. Desplegar Edge Functions

Instalar Supabase CLI si no lo tenés:
```bash
npm install -g supabase
```

Autenticarse y vincular el proyecto:
```bash
supabase login
supabase link --project-ref TU_PROJECT_ID
```

Configurar secrets (los valores reales de las APIs):
```bash
supabase secrets set CLAUDE_API_KEY=sk-ant-...
supabase secrets set OPENAI_API_KEY=sk-proj-...
supabase secrets set MP_ACCESS_TOKEN=APP_USR-...
```

Desplegar las cuatro funciones:
```bash
supabase functions deploy claude
supabase functions deploy tts
supabase functions deploy create-payment
supabase functions deploy mp-webhook
```

## 6. Configurar MercadoPago

1. Crear cuenta en [mercadopago.com.ar](https://mercadopago.com.ar) → Credenciales → Producción
2. Copiar **Access Token** (`APP_USR-...`) y configurarlo como secret (paso anterior)
3. En el dashboard de MP → Notificaciones IPN → agregar la URL:
   ```
   https://TU_PROJECT_ID.supabase.co/functions/v1/mp-webhook
   ```
4. Seleccionar tópico: **Pagos**

## 7. Variables de entorno en Edge Functions

Las funciones leen automáticamente desde los secrets de Supabase:

| Secret | Descripción |
|---|---|
| `CLAUDE_API_KEY` | API key de Anthropic (platform.anthropic.com) |
| `OPENAI_API_KEY` | API key de OpenAI (platform.openai.com) |
| `MP_ACCESS_TOKEN` | Access token de MercadoPago producción |
| `SUPABASE_URL` | Auto-inyectado por Supabase |
| `SUPABASE_ANON_KEY` | Auto-inyectado por Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-inyectado por Supabase (solo mp-webhook lo usa) |

## 8. Verificar el flujo completo

1. **Registro**: abrir la app → pantalla de login → registrarse con email
2. **Verificar perfil**: en Supabase → Table Editor → profiles → debería aparecer el usuario con `is_premium = false`
3. **Pago de prueba**: ir a Ajustes → Premium → Suscribirme → completar con [tarjeta de prueba de MP](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro/additional-content/your-integrations/test/cards)
4. **Verificar activación**: la columna `is_premium` debería cambiar a `true` automáticamente vía webhook
5. **Verificar Realtime**: en la app, el badge Premium en Ajustes debería actualizarse sin reiniciar

## 9. Paquetes adicionales a instalar antes del primer build

```bash
npx expo install jszip mammoth expo-speech @supabase/supabase-js react-native-url-polyfill expo-secure-store
```

Remover los stubs de tipos una vez instalados los paquetes reales:
- `src/types/jszip.d.ts`
- `src/types/mammoth.d.ts`
- `src/types/expo-speech.d.ts`
- `src/types/expo-secure-store.d.ts`
