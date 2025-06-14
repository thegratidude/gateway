# EMERGENCY RECOVERY GUIDE
Commit: 0d7593dc
Repo: thegratidude/gateway

QUICK RECOVERY:
cd /Users/jonathangould/Documents/projects/hum/gateway
git fetch fork
git checkout -b development fork/development
npm install
npm run build && npm start
npx ts-node examples/round-trip-swap-test.ts
