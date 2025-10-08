#!/usr/bin/env bash
# exit on error
set -o errexit

# Cài đặt các thư viện từ package.json
npm install

# Cài đặt trình duyệt cho Puppeteer
npx puppeteer browsers install chrome
