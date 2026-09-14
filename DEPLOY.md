# Сервер в интернете

Как поднять «Красную нить» в режиме «в сети»: комнаты, HTTPS, защита. Нужны VPS, домен и доступ
к репозиторию дел.

## 1. Сервер

Хватит VPS на 2 ядра, 4 ГБ памяти и 30 ГБ диска с Ubuntu 24.04: игра держит сотни комнат, тяжёлое —
картинки и звук — отдаёт CDN. Подойдут Timeweb Cloud или Selectel (оплата картой РФ, дата-центры
в Москве и Петербурге).

```bash
ssh root@<ip>
apt update && apt upgrade -y
curl -fsSL https://get.docker.com | sh
adduser game && usermod -aG docker game
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```

Дальше всё от пользователя `game`.

## 2. Код

Репозиторий дел закрытый — серверу нужен ключ только на чтение (deploy key):

```bash
ssh-keygen -t ed25519 -f ~/.ssh/red_thread_secret -N ''
cat ~/.ssh/red_thread_secret.pub
```

Этот публичный ключ добавить в GitHub: `red-thread-secret` → Settings → Deploy keys → Add
(без галочки записи). Затем:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github-secret
  HostName github.com
  IdentityFile ~/.ssh/red_thread_secret
EOF
mkdir -p ~/red-thread && cd ~/red-thread
git clone https://github.com/flamediman/red-thread-public.git
git clone git@github-secret:flamediman/red-thread-secret.git
```

## 3. Домен и Cloudflare

1. Домен (например, в reg.ru или nic.ru) переводится на DNS Cloudflare (бесплатный тариф).
2. В Cloudflare: A-запись `@` → IP сервера, облако оранжевое (проксирование включено).
3. SSL/TLS → режим **Full (strict)**. Network → **WebSockets: On**.
4. Caching → Cache Rules: для путей `/art/*`, `/voice/*`, `/music/*`, `/sfx/*`, `/_nuxt/*` —
   «Eligible for cache», Edge TTL — «Use cache-control header». Медиа уйдут в CDN, сервер разгрузится.
5. Security → WAF → Rate limiting: правило на `/_ws` — не больше 60 запросов за 10 секунд с одного IP
   (защита от волны подключений; игроку хватает одного соединения).

За Cloudflare злоумышленник может обойти защиту, если знает IP сервера и ходит на него напрямую.
Закройте 80 и 443 для всех, кроме адресов Cloudflare:

```bash
sudo tee /usr/local/bin/cf-ufw.sh > /dev/null <<'SH'
#!/bin/sh
# 80/443 — только с адресов Cloudflare; список обновляется раз в неделю
for r in $(ufw status numbered | grep -E '(80|443)' | grep -oE '^\[ *[0-9]+\]' | tr -d '[] ' | sort -rn); do ufw --force delete "$r"; done
for ip in $(curl -fsS https://www.cloudflare.com/ips-v4) $(curl -fsS https://www.cloudflare.com/ips-v6); do
  ufw allow proto tcp from "$ip" to any port 80,443 comment cloudflare > /dev/null
done
SH
sudo chmod +x /usr/local/bin/cf-ufw.sh && sudo /usr/local/bin/cf-ufw.sh
echo '17 4 * * 1 root /usr/local/bin/cf-ufw.sh' | sudo tee /etc/cron.d/cf-ufw
```

Caddy работает в сети хоста (`network_mode: host`), поэтому эти правила действительно закрывают порты: опубликованные
порты контейнеров Docker обходят ufw. Сертификат продлевается и так — Let's Encrypt проверяет домен через Cloudflare
по HTTP, а он пропускает запрос до сервера. В `deploy/.env` за Cloudflare — `REAL_IP_HEADER=cf-connecting-ip`.

## 4. Запуск

```bash
cd ~/red-thread/red-thread-public/deploy
cp .env.example .env
nano .env                         # DOMAIN, ссылки на канал и донат; за Cloudflare — REAL_IP_HEADER=cf-connecting-ip
                                  # домена ещё нет — DOMAIN=http://<IP сервера>, игра откроется по HTTP
mkdir -p data && sudo chown 1000:1000 data
docker compose up -d --build
docker compose logs -f party      # «режим «в сети»: комнат восстановлено 0»
```

Проверка: `https://<домен>/` показывает кнопку «Открыть комнату», `https://<домен>/api/config`
отвечает `"mode":"public"`.

## 5. Обновление

```bash
cd ~/red-thread/red-thread-secret && git pull
cd ../red-thread-public && git pull
cd deploy && docker compose up -d --build
```

Открытые экраны и телефоны сами перезагрузятся на новую сборку. Комнаты переживают перезапуск:
снимки лежат в `deploy/data/rooms`.

## 6. Резервные копии

В `deploy/data` — только снимки текущих комнат (закрываются через 3–12 часов без людей).
Код и дела — в git. Регулярный бэкап не обязателен; при переезде достаточно скопировать `data`.

## 7. Нагрузка и безопасность

- Ограничения движка: `MAX_ROOMS` (300), не больше 150 соединений с адреса (у мобильных операторов
  много абонентов за одним адресом) и 20 новых комнат за 10 минут, 10 неверных ключей экрана за 10 минут,
  60 несуществующих кодов комнат в минуту, 15 сообщений в секунду на соединение, сообщение не больше 16 КБ.
- Проверка нагрузки — боты: из папки проекта на другой машине
  `for i in $(seq 20); do ONLINE=1 FAST=1 ORIGIN=https://<домен> node tools/simulate.mjs 6 & done`
  (с одного адреса прогон упрётся в пределы — на время теста поднимите `MAX_SOCKETS_PER_IP` и
  `MAX_NEW_ROOMS_PER_IP` в `deploy/docker-compose.yml` или запускайте ботов с нескольких машин).
- Контейнеру выделено 1,5 ядра и 1 ГБ памяти (`deploy/docker-compose.yml`).
- Персональные данные в режиме «в сети» не собираются: фото выключены, имена — псевдонимы,
  хранятся в снимке комнаты до её закрытия.
