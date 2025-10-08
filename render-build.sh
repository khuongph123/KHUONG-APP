#!/usr/bin/env bash
# exit on error
set -o errexit

# Tăng bộ nhớ ảo (swap) để Puppeteer chạy ổn định trên gói Free
fallocate -l 1G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile

# Cài đặt các thư viện từ package.json
npm install

# Cài đặt trình duyệt cho Puppeteer
npx puppeteer browsers install chrome
