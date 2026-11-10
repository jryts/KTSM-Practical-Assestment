// stop-staging-vm.js
const { Compute } = require('@google-cloud/compute');

const compute = new Compute();
const PROJECT_ID = process.env.PROJECT_ID;
const ZONES = (process.env.ZONES || 'europe-west1-b,europe-west1-c').split(',');

/**
 * Stop (or start) all VMs with label env=staging.
 * Called by Cloud Scheduler:
 *   - 18:00 Mon–Fri → stop
 *   - 07:30 Mon–Fri → start
 */
exports.toggleStagingVMs = async (req, res) => {
  const action = req.query.action === 'start' ? 'start' : 'stop';
  const results = { action, instances: [], errors: [] };

  for (const zone of ZONES) {
    const [instances] = await compute.instances.list(PROJECT_ID, {
      zone,
      filter: `labels.env=staging`,
    });

    for (const vm of instances) {
      const targetState = action === 'stop' ? 'TERMINATED' : 'RUNNING';
      if (vm.status === targetState) continue; // already in desired state

      try {
        const [op] = await compute.instances[action](PROJECT_ID, zone, vm.name);
        await waitOp(op, zone);
        results.instances.push(`${vm.name} (${zone}) → ${action}`);
        console.log(`${vm.name} in ${zone} ${action}ed`);
      } catch (err) {
        results.errors.push(`${vm.name}: ${err.message}`);
      }
    }
  }

  res.status(200).json(results);
};

async function waitOp(op, zone, timeoutMs = 120_000) {
  const start = Date.now();
  let current = op;
  while (current.status !== 'DONE') {
    if (Date.now() - start > timeoutMs) throw new Error(`Op ${current.name} timed out`);
    await new Promise(r => setTimeout(r, 5000));
    [current] = await compute.zoneOperations.get(PROJECT_ID, zone, current.name);
  }
  if (current.error) throw new Error(JSON.stringify(current.error));
}   
