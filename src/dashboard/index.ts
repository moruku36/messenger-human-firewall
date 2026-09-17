import { createDashboardServer } from './server.js';

const port = Number(process.env.DASHBOARD_PORT || 3000);
const dashboard = createDashboardServer({ port });

dashboard.start().then(() => {
  console.log(`\n🛡️ Messenger Human Firewall Dashboard running at http://localhost:${port}`);
  console.log(`- Status API: http://localhost:${port}/api/status`);
  console.log(`- Threads API: http://localhost:${port}/api/threads`);
  console.log('Press Ctrl+C to terminate dashboard.\n');
}).catch((err) => {
  console.error('Failed to start dashboard server:', err);
  process.exit(1);
});
