#!/usr/bin/env bash
# cap-sync-ios.sh
# Runs `cap sync` then restores the packageClassList that cap sync wipes
# (packageClassList is a non-standard Capacitor 7 field for inline plugin discovery).

set -e

echo "▶  cap sync..."
npx cap sync ios

CONFIG="ios/App/App/capacitor.config.json"
echo "🔧  Restoring packageClassList in $CONFIG..."

node -e "
const fs = require('fs');
const cfg = JSON.parse(fs.readFileSync('$CONFIG', 'utf8'));
cfg.packageClassList = [
  'AppPlugin',
  'CAPBrowserPlugin',
  'LiveActivityPlugin',
  'ScreenTimePlugin',
  'WidgetDataPlugin'
];
fs.writeFileSync('$CONFIG', JSON.stringify(cfg, null, '\t') + '\n');
console.log('✅  packageClassList restored:', cfg.packageClassList);
"
