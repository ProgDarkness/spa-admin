# Seguridad en Fase 0 (mock)

## Alcance

El mock no es frontera de seguridad. `authorize` (`src/lib/mock/authorize.ts`) y `RequireSession` corren solo en el cliente: cualquiera con acceso al bundle puede saltarlos. El export estático (`output: 'export'`) sirve todas las rutas y datos sin autenticación.

## Credencial demo

`demo1234` (`SEED_PASSWORD`) viaja dentro del bundle. No publicar el despliegue sin una puerta de acceso delante (basic auth o password del hosting).

## Migración a backend

- `authorize` se ejecuta en el servidor; el cliente solo oculta UI.
- Sesión en cookie `HttpOnly` (`Secure`, `SameSite`).
- Hash de contraseñas con argon2.
- Rate limiting en el login.
- El cliente mapea `error.code` a textos propios; no muestra el `message` del servidor.
- Cabeceras de seguridad (CSP, `X-Frame-Options`, `Referrer-Policy`, `X-Content-Type-Options: nosniff`) se configuran en el hosting, porque `output: 'export'` no admite `headers()`.

## Dependencias

Los `overrides` de `package.json` (`compression ^1.8.2`, `minimatch ^11.0.1`) cierran GHSA-vc2v-76pw-4v95 y GHSA-g3hv-75wg-m249. `bun audit` queda limpio.

## Cobertura de autorización

`src/features/authorization.matrix.test.ts` verifica que las mutaciones devuelvan `forbidden` sin tocar el store con los roles `lectura` y `recepcion`.
