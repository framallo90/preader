# Sacar Bardo del servidor

**Fecha:** 2026-09-22 · **Estado:** pendiente de ejecutar

Bardo ya no tiene backend: la app no hace **ninguna** llamada de red (verificado: cero `fetch`,
cero `axios`, cero URLs en `src/`, `app/` y los módulos). Todo lo que hacía el server lo hace hoy
el teléfono — el PDF con Pdfium, los cómics con 7-Zip y la voz con el TTS de Android.

Lo que sigue en el servidor de ese proyecto es basura que ocupa lugar y deja un puerto abierto.

## ⚠️ Lo que NO se toca

En ese servidor viven **booklo**, **investy** y **facuramallo** (.com.ar). Nada de este
documento los toca. En concreto:

- No se toca ningún vhost de nginx salvo uno que sea **exclusivamente** de Bardo.
- No se corre `nginx -s reload` sin antes haber pasado `nginx -t`.
- No se borra nada fuera de la carpeta de Bardo y su `storage/`.
- Si algo no queda claro a cuál proyecto pertenece, **no se borra**: se pregunta.

## Qué dejó Bardo ahí

Sale del commit `727847f` (el último con `server/`) y de `3054a01`, que lo borró del repo.

| Qué | Detalle |
|---|---|
| App Node | `bardo-server` (express + multer), `server.js` escuchando en **:3010** |
| Módulos | `pipeline.js`, `fingerprint.js`, `textClean.js` |
| Python | `extract.py`, `render_page.py` y un **`venv/`** propio dentro de la carpeta de la app |
| Datos | `storage/books/<id>/` con `status.json`, `raw.txt`, `fulltext.txt`, `cover.png` y `pages/p<N>-w<ancho>.png` |
| Subidas | `storage/uploads/` (destino de multer: los archivos crudos que subía la app) |
| Config | `.env` con `PORT` y **`BARDO_TOKEN`** |
| Probable | un servicio systemd o pm2, un vhost/proxy de nginx a `:3010`, quizá un cert de un subdominio |

**`storage/` puede pesar bastante:** son libros tuyos subidos, ya renderizados página por página a
PNG. Los originales los tenés en el teléfono y en la compu, así que no hay nada irrecuperable,
pero conviene mirar el tamaño antes de borrar.

## Paso 1 — Inventario (sólo lee, no borra nada)

```bash
ssh ramallosfacundo-srv 'bash -s' < docs/ops/inventario-bardo-en-el-server.sh
```

Devuelve: servicios con nombre bardo, quién escucha en 3010, procesos, carpetas del proyecto,
cuánto pesa el storage y cuántos libros hay, qué archivos de nginx mencionan bardo o el 3010,
certificados, tareas programadas y si el firewall tiene el 3010 abierto.

**No sigas al paso 2 sin haber leído esa salida.** El resto depende de qué aparezca.

## Paso 2 — Apagar antes de borrar

Primero que deje de correr; recién después se tocan los archivos.

```bash
# con el nombre real que haya salido en el inventario
sudo systemctl stop bardo-server
sudo systemctl disable bardo-server
# o, si era pm2:
pm2 stop bardo-server && pm2 delete bardo-server && pm2 save
```

Comprobar que el 3010 quedó libre:

```bash
ss -ltnp | grep :3010    # no tiene que devolver nada
```

## Paso 3 — Copia de respaldo antes de borrar

Barato y te deja volver atrás si algo se usaba y no nos dimos cuenta:

```bash
# <RUTA> es la carpeta que haya salido en el paso 1
sudo tar czf /root/bardo-server-backup-$(date +%F).tar.gz <RUTA>
ls -lh /root/bardo-server-backup-*.tar.gz
```

Si el `storage/` pesa demasiado para respaldarlo entero, respaldá sólo el código y la config
(`--exclude='storage'`): los PNG de páginas se pueden regenerar y los libros los tenés vos.

## Paso 4 — Borrar

```bash
sudo rm -rf <RUTA>                       # la carpeta de la app, con su venv y su storage
sudo rm -f /etc/systemd/system/bardo-server.service
sudo systemctl daemon-reload
```

## Paso 5 — nginx, sólo si el inventario encontró algo de Bardo

Si el paso 1 listó un archivo de nginx que menciona bardo o `:3010`, **abrilo y confirmá que sea
únicamente de Bardo** antes de tocarlo. Si comparte archivo con otro sitio, no lo borres: sacá sólo
el bloque de Bardo.

```bash
sudo rm /etc/nginx/sites-enabled/<el-de-bardo>
sudo rm /etc/nginx/sites-available/<el-de-bardo>
sudo nginx -t          # TIENE que dar "syntax is ok" y "test is successful"
sudo systemctl reload nginx
```

Si `nginx -t` falla, **no recargues**: volvé atrás el archivo y revisá. Ahí es donde se caen los
otros tres sitios.

## Paso 6 — Cerrar el puerto

```bash
sudo ufw delete allow 3010
sudo ufw status
```

## Paso 7 — El certificado, sólo si había un subdominio de Bardo

```bash
sudo certbot delete --cert-name <el-de-bardo>
```

Y si había un registro DNS apuntando a ese subdominio, sacalo también.

## Paso 8 — Las claves

Esto es del lado tuyo, no del servidor:

- `src/config/apiKeys.ts` sigue en tu disco (gitignoreado, **no lo importa nadie** — verificado).
  Tiene `BARDO_SERVER_URL` y `BARDO_TOKEN` del server viejo, más lo que haya quedado de la etapa
  con IA. **Borralo y rotá lo que siga siendo válido en otro lado.**
- El `BARDO_TOKEN` muere con el server, pero si lo reusaste en algún lado, cambialo.

## Por qué no lo hice yo

Intenté conectarme a hacer el inventario y el entorno me bloqueó el acceso a producción
("Production Reads"). No lo esquivé. Si querés que lo haga yo, hay que habilitar el permiso;
si no, los pasos de arriba se pegan tal cual.
