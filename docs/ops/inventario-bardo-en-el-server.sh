#!/usr/bin/env bash
# Inventario de lo que Bardo dejó en el servidor. SOLO LEE: no borra ni para nada.
# Uso:  ssh ramallosfacundo-srv 'bash -s' < inventario-bardo.sh
#
# Los sitios booklo / investy / facuramallo NO se tocan ni se listan acá.

echo "===== 1. Servicios con nombre bardo ====="
systemctl list-units --all --no-pager 2>/dev/null | grep -i bardo || echo "  (ningun servicio systemd)"
systemctl list-unit-files --no-pager 2>/dev/null | grep -i bardo || true
command -v pm2 >/dev/null && pm2 list 2>/dev/null | grep -i bardo || echo "  (pm2: no esta o no tiene bardo)"

echo
echo "===== 2. Quien escucha en el puerto 3010 ====="
(ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | grep -E ':3010' || echo "  (nadie escucha en 3010)"

echo
echo "===== 3. Procesos node/python de bardo ====="
ps -eo pid,user,etime,cmd 2>/dev/null | grep -iE "bardo|server\.js|render_page\.py" | grep -v grep || echo "  (ninguno)"

echo
echo "===== 4. Carpetas del proyecto ====="
for d in /opt /srv /var/www /home/*/ /root; do
  find "$d" -maxdepth 3 -type d \( -iname "*bardo*" -o -iname "*preader*" \) 2>/dev/null
done | sort -u || true
echo "--- archivos sueltos del server viejo:"
find / -maxdepth 6 -type f \( -name "pipeline.js" -o -name "render_page.py" -o -name "fingerprint.js" -o -name "textClean.js" \) \
  -not -path "*/node_modules/*" 2>/dev/null | head -20 || echo "  (ninguno)"

echo
echo "===== 5. Cuanto pesa el storage (los libros subidos) ====="
find / -maxdepth 7 -type d -path "*storage/books" -not -path "*/node_modules/*" 2>/dev/null | while read -r d; do
  echo "  $d"
  du -sh "$d" 2>/dev/null
  echo "    libros guardados: $(ls -1 "$d" 2>/dev/null | wc -l)"
done
find / -maxdepth 7 -type d -path "*storage/uploads" -not -path "*/node_modules/*" 2>/dev/null | while read -r d; do
  echo "  $d"; du -sh "$d" 2>/dev/null
done

echo
echo "===== 6. nginx: SOLO lo que menciona bardo o el puerto 3010 ====="
grep -rilE "bardo|:3010" /etc/nginx/ 2>/dev/null || echo "  (nada en nginx menciona bardo)"

echo
echo "===== 7. Certificados / subdominios de bardo ====="
ls -1 /etc/letsencrypt/live/ 2>/dev/null | grep -i bardo || echo "  (ningun cert de bardo)"

echo
echo "===== 8. Tareas programadas ====="
crontab -l 2>/dev/null | grep -i bardo || echo "  (nada en el crontab del usuario)"
grep -ril bardo /etc/cron.d/ /etc/cron.daily/ 2>/dev/null || echo "  (nada en /etc/cron.*)"

echo
echo "===== 9. Firewall: 3010 abierto? ====="
(ufw status 2>/dev/null | grep -E "3010|Status") || echo "  (ufw no disponible)"

echo
echo "===== FIN. Nada de esto borro nada. ====="
