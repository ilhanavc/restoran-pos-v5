---
name: hetzner-deployment
description: Use when provisioning, configuring, or deploying to Hetzner Cloud servers. Covers server creation, Ubuntu 24.04 setup, Nginx, PostgreSQL, PM2, Let's Encrypt SSL, backup strategy, and monitoring.
---

# Hetzner Cloud Deployment

Türk KVKK uyumu için Almanya'da hosting. Ucuz, güvenilir, managed service'ler yok — kendimiz kuruyoruz.

## Server tercihi (başlangıç)

**CX22** (Intel/AMD, shared vCPU):
- 2 vCPU
- 4 GB RAM
- 40 GB NVMe SSD
- 20 TB trafik
- ~5-6 €/ay

Pilot için fazlasıyla yeterli. İlk 10 müşteriye kadar ölçeklenir.

Ölçekleme:
- CX32 (4 vCPU, 8 GB) — 10-30 müşteri
- CX42 (8 vCPU, 16 GB) — 30-100 müşteri
- Sonrası: dedicated CCX24 veya load balancer + multiple app server

## Lokasyon

Nuremberg (NBG) veya Falkenstein (FSN1) — Türkiye'ye en yakın (~50ms latency).

## Provisioning (Ansible)

Manuel SSH ile kurulum yasak. Her şey kod olarak.

`infrastructure/ansible/` yapısı:

```
infrastructure/ansible/
├── inventory/
│   ├── production.yml
│   └── staging.yml
├── playbooks/
│   ├── provision.yml         # Sıfırdan server setup
│   ├── deploy.yml            # App deployment
│   ├── backup.yml            # Scheduled backup
│   └── update.yml            # OS/security updates
├── roles/
│   ├── base/                 # user, ssh, firewall, fail2ban
│   ├── nginx/
│   ├── postgres/
│   ├── nodejs/
│   ├── pm2/
│   └── monitoring/
└── ansible.cfg
```

## İlk provisioning

### 1. Base security

```yaml
# roles/base/tasks/main.yml
- name: Create deploy user
  ansible.builtin.user:
    name: deploy
    groups: sudo
    shell: /bin/bash

- name: Add SSH key for deploy user
  ansible.posix.authorized_key:
    user: deploy
    key: "{{ lookup('file', deploy_ssh_pubkey_file) }}"

- name: Disable root SSH login
  ansible.builtin.lineinfile:
    path: /etc/ssh/sshd_config
    regexp: '^PermitRootLogin'
    line: 'PermitRootLogin no'
    state: present
  notify: restart ssh

- name: Disable password SSH auth
  ansible.builtin.lineinfile:
    path: /etc/ssh/sshd_config
    regexp: '^PasswordAuthentication'
    line: 'PasswordAuthentication no'
  notify: restart ssh

- name: Install UFW firewall
  ansible.builtin.apt:
    name: ufw
    state: present

- name: Allow SSH
  community.general.ufw:
    rule: allow
    name: OpenSSH

- name: Allow HTTP/HTTPS
  community.general.ufw:
    rule: allow
    port: "{{ item }}"
    proto: tcp
  loop: [80, 443]

- name: Enable UFW
  community.general.ufw:
    state: enabled
    policy: deny

- name: Install fail2ban
  ansible.builtin.apt:
    name: fail2ban
    state: present

- name: Unattended security upgrades
  ansible.builtin.apt:
    name: unattended-upgrades
    state: present
```

### 2. Nginx (reverse proxy + SSL)

```yaml
# roles/nginx/tasks/main.yml
- name: Install Nginx + Certbot
  ansible.builtin.apt:
    name: [nginx, certbot, python3-certbot-nginx]
    state: present

- name: Deploy nginx config
  ansible.builtin.template:
    src: nginx.conf.j2
    dest: /etc/nginx/sites-available/restoran-pos
  notify: reload nginx

- name: Enable site
  ansible.builtin.file:
    src: /etc/nginx/sites-available/restoran-pos
    dest: /etc/nginx/sites-enabled/restoran-pos
    state: link
  notify: reload nginx

- name: Obtain SSL cert
  ansible.builtin.command: >
    certbot --nginx -d {{ domain }} -d api.{{ domain }} -d admin.{{ domain }}
    --non-interactive --agree-tos -m {{ admin_email }}
  args:
    creates: /etc/letsencrypt/live/{{ domain }}
```

Nginx config template (nginx.conf.j2):
```nginx
# Cloud API
server {
  listen 443 ssl http2;
  server_name api.{{ domain }};

  ssl_certificate     /etc/letsencrypt/live/{{ domain }}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/{{ domain }}/privkey.pem;

  client_max_body_size 5m;

  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

# Admin web
server {
  listen 443 ssl http2;
  server_name admin.{{ domain }};

  root /var/www/admin;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }

  location /assets/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }
}

# HTTP → HTTPS redirect
server {
  listen 80;
  server_name {{ domain }} api.{{ domain }} admin.{{ domain }};
  return 301 https://$host$request_uri;
}
```

### 3. PostgreSQL

```yaml
# roles/postgres/tasks/main.yml
- name: Install PostgreSQL 17
  ansible.builtin.apt:
    name: postgresql-17
    state: present

- name: Configure postgresql.conf
  ansible.builtin.template:
    src: postgresql.conf.j2
    dest: /etc/postgresql/17/main/postgresql.conf
  notify: restart postgres

- name: Configure pg_hba.conf
  ansible.builtin.template:
    src: pg_hba.conf.j2
    dest: /etc/postgresql/17/main/pg_hba.conf
  notify: restart postgres

- name: Create app database
  community.postgresql.postgresql_db:
    name: restoran_pos
    state: present
  become_user: postgres

- name: Create app user
  community.postgresql.postgresql_user:
    db: restoran_pos
    name: app_user
    password: "{{ postgres_app_password }}"
    priv: "CONNECT"
  become_user: postgres
```

PostgreSQL tuning (CX22 için):
```
# postgresql.conf.j2
shared_buffers = 1GB
effective_cache_size = 3GB
maintenance_work_mem = 256MB
work_mem = 16MB
wal_buffers = 16MB
max_connections = 50
random_page_cost = 1.1  # SSD için
effective_io_concurrency = 200
```

### 4. Node.js + PM2

```yaml
# roles/nodejs/tasks/main.yml
- name: Add NodeSource GPG key
  ansible.builtin.get_url:
    url: https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key
    dest: /etc/apt/keyrings/nodesource.gpg

- name: Add NodeSource repository
  ansible.builtin.apt_repository:
    repo: "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main"

- name: Install Node.js 22
  ansible.builtin.apt:
    name: nodejs
    state: present

- name: Install pnpm globally
  ansible.builtin.command: npm install -g pnpm@9

- name: Install PM2 globally
  ansible.builtin.command: npm install -g pm2

- name: PM2 startup
  ansible.builtin.command: pm2 startup systemd -u deploy --hp /home/deploy
```

### 5. Deployment (app update)

```yaml
# playbooks/deploy.yml
- hosts: app_servers
  become_user: deploy
  tasks:
    - name: Pull latest code
      ansible.builtin.git:
        repo: git@github.com:owner/restoran-pos-v4.git
        dest: /home/deploy/app
        version: "{{ deploy_version | default('main') }}"

    - name: Install dependencies
      ansible.builtin.command: pnpm install --frozen-lockfile
      args:
        chdir: /home/deploy/app

    - name: Build API
      ansible.builtin.command: pnpm --filter api build
      args:
        chdir: /home/deploy/app

    - name: Run DB migrations
      ansible.builtin.command: pnpm --filter api migrate
      args:
        chdir: /home/deploy/app

    - name: Build admin web
      ansible.builtin.command: pnpm --filter admin-web build
      args:
        chdir: /home/deploy/app

    - name: Deploy admin web files
      ansible.builtin.synchronize:
        src: /home/deploy/app/apps/admin-web/dist/
        dest: /var/www/admin/

    - name: Restart API via PM2
      ansible.builtin.command: pm2 reload api
```

## Backup stratejisi

### PostgreSQL
```yaml
# Daily pg_dump
- name: Backup PostgreSQL
  ansible.builtin.cron:
    name: "postgres daily backup"
    hour: "3"
    minute: "0"
    job: >
      pg_dump -U postgres restoran_pos | gzip
      > /backups/postgres/restoran_pos-$(date +\%Y\%m\%d).sql.gz

# Weekly to off-site (Hetzner Storage Box veya AWS S3)
- name: Sync to offsite
  ansible.builtin.cron:
    name: "postgres offsite sync"
    hour: "4"
    minute: "0"
    weekday: "0"
    job: >
      rclone sync /backups/postgres/ b2:restoran-pos-backups/
```

Retention:
- Günlük: 14 gün
- Haftalık: 8 hafta
- Aylık: 12 ay

### Point-in-time recovery (PITR)
Phase 2'de WAL archiving + pgBackRest ile PITR eklenir. Pilot için daily dump yeterli.

## Monitoring

- **Uptime**: Uptime Robot (ücretsiz) — dışardan ping
- **Application**: Sentry (hata izleme, self-hosted veya cloud)
- **Metrics**: Prometheus + Grafana (self-hosted, ikinci mini server)
- **Logs**: Loki (Grafana tarafından)
- **Alerts**: Slack webhook veya Telegram bot

## Environment config

Secrets yönetimi:
- `.env` dosyası server'da (git'e girmez)
- Backup: 1Password vault'ta manuel
- Rotation: 90 günde bir

```bash
# /home/deploy/app/.env
DATABASE_URL=postgresql://app_user:xxx@localhost:5432/restoran_pos
JWT_SECRET=<64-char random>
SENTRY_DSN=https://xxx@sentry.io/xxx
CLOUDFLARE_R2_*=xxx
YEMEKSEPETI_API_KEY=xxx
IYZICO_API_KEY=xxx
IYZICO_SECRET_KEY=xxx
```

## DR (Disaster Recovery) plan

Senaryo: server çöktü.
1. Hetzner Cloud Console'dan snapshot'tan yeni server (5 dk)
2. DNS TTL düşük tutulur (300sn), IP değiştir (5 dk)
3. Latest backup restore (gerekirse, 10-30 dk)
4. Toplam RTO: ~30-45 dakika
5. RPO: son daily backup + WAL (v1'de WAL yok, pilot için kabul)

## Cost tracker

Beklenen aylık:
- CX22: 5.83 €
- Domain: 1 €
- SSL: 0 € (Let's Encrypt)
- Backup storage (Storage Box 1TB): 3.81 €
- Monitoring (Uptime Robot free + self-hosted): 0 €
- Sentry (ücretsiz tier): 0 €
- Toplam: **~11 €/ay**

10 müşteriyle CX32'ye geç: +10 €/ay. 100 müşteriyle CX42: +30 €/ay.
