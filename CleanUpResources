const { RecommenderClient } = require('@google-cloud/recommender');
const compute = require('@google-cloud/compute');

const DRY_RUN = process.env.DRY_RUN !== 'false';
const PROJECT_ID = process.env.PROJECT_ID || '';
const LABEL_KEY = process.env.LABEL_KEY || '';
const LABEL_VALUE = process.env.LABEL_VALUE || '';

const instancesClient = new compute.InstancesClient();
const disksClient = new compute.DisksClient();
const addressesClient = new compute.AddressesClient();
const snapshotsClient = new compute.SnapshotsClient();
const zoneOpsClient = new compute.ZoneOperationsClient();
const regionOpsClient = new compute.RegionOperationsClient();
const recommenderClient = new RecommenderClient();

/**
 * HTTP Cloud Function to delete idle GCP resources.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
exports.cleanupIdleResources = async (req, res) => {
  const results = {
    dryRun: DRY_RUN,
    stoppedVMs: [],
    deletedDisks: [],
    releasedIPs: [],
    errors: [],
  };

  try {
    results.stoppedVMs = await processIdleVMs();
    results.deletedDisks = await processIdleDisisks();
    results.releasedIPs = await processIdleIPs();
  } catch (err) {
    results.errors.push(err.message);
    console.error('Cleanup failed:', err);
  }

  res.status(200).json(results);
};

// ─── Idle VMs ────────────────────────────────────────────────────────────────

async function processIdleVMs() {
  const stopped = [];
  const parent = `projects/${PROJECT_ID}/locations/global`;

  const [recommendations] = await recommenderClient.listRecommendations({
    parent,
    filter: 'recommenderSubtype="STOP_INSTANCE"',
  });

  for (const rec of recommendations) {
    if (rec.stateInfo?.state !== 'ACTIVE') continue;

    const resourceName = rec.primaryImpact?.resourceName || '';
    const parts = resourceName.split('/');
    const zone = parts[parts.indexOf('zones') + 1];
    const instanceName = parts[parts.length - 1];

    // Optional label filter
    if (LABEL_KEY && LABEL_VALUE) {
      const [instance] = await instancesClient.get({
        project: PROJECT_ID, zone, instance: instanceName,
      }).catch(() => [null]);
      if (!instance || instance.labels?.[LABEL_KEY] !== LABEL_VALUE) continue;
    }

    if (DRY_RUN) {
      stopped.push(`[DRY] ${instanceName} (${zone})`);
      console.log(`[DRY] Would stop ${instanceName} in ${zone}`);
    } else {
      const [op] = await instancesClient.stop({
        project: PROJECT_ID, zone, instance: instanceName,
      });
      await waitZoneOp(op);
      await markSucceeded(rec);
      stopped.push(`${instanceName} (${zone})`);
      console.log(`Stopped ${instanceName} in ${zone}`);
    }
  }
  return stopped;
}

// ─── Idle Disks ──────────────────────────────────────────────────────────────

async function processIdleDisks() {
  const deleted = [];
  const parent = `projects/${PROJECT_ID}/locations/global`;

  const [recommendations] = await recommenderClient.listRecommendations({
    parent,
    filter: 'recommenderSubtype="SNAPSHOT_AND_DELETE_DISK"',
  });

  for (const rec of recommendations) {
    if (rec.stateInfo?.state !== 'ACTIVE') continue;

    const resourceName = rec.primaryImpact?.resourceName || '';
    const parts = resourceName.split('/');
    const zone = parts[parts.indexOf('zones') + 1];
    const diskName = parts[parts.length - 1];

    if (DRY_RUN) {
      deleted.push(`[DRY] ${diskName} (${zone})`);
      console.log(`[DRY] Would snapshot+delete ${diskName} in ${zone}`);
    } else {
      // Snapshot first
      const snapName = `auto-snap-${diskName}`;
      const [snapOp] = await snapshotsClient.create({
        project: PROJECT_ID,
        snapshotResource: {
          name: snapName,
          sourceDisk: `projects/${PROJECT_ID}/zones/${zone}/disks/${diskName}`,
        },
      });
      await waitZoneOp(snapOp);

      // Delete disk
      const [delOp] = await disksClient.delete({
        project: PROJECT_ID, zone, disk: diskName,
      });
      await waitZoneOp(delOp);

      await markSucceeded(rec);
      deleted.push(`${diskName} (${zone})`);
      console.log(`Snapshot+deleted ${diskName} in ${zone}`);
    }
  }
  return deleted;
}

// ─── Idle External IPs ───────────────────────────────────────────────────────

async function processIdleIPs() {
  const released = [];
  const parent = `projects/${PROJECT_ID}/locations/global`;

  const [recommendations] = await recommenderClient.listRecommendations({
    parent,
    filter: 'recommenderSubtype="DELETE_ADDRESS"',
  });

  for (const rec of recommendations) {
    if (rec.stateInfo?.state !== 'ACTIVE') continue;

    const resourceName = rec.primaryImpact?.resourceName || '';
    const parts = resourceName.split('/');
    const region = parts[parts.indexOf('regions') + 1];
    const addressName = parts[parts.length - 1];

    if (DRY_RUN) {
      released.push(`[DRY] ${addressName} (${region})`);
      console.log(`[DRY] Would release IP ${addressName} in ${region}`);
    } else {
      const [op] = await addressesClient.delete({
        project: PROJECT_ID, region, address: addressName,
      });
      await waitRegionOp(op);
      await markSucceeded(rec);
      released.push(`${addressName} (${region})`);
      console.log(`Released IP ${addressName} in ${region}`);
    }
  }
  return released;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function waitZoneOp(op, timeoutMs = 300_000) {
  const start = Date.now();
  let current = op;
  while (current.status !== 'DONE') {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Zone operation ${current.name} timed out`);
    }
    await sleep(5000);
    [current] = await zoneOpsClient.get({
      project: PROJECT_ID,
      operation: current.name,
      zone: current.zone?.split('/').pop() || '',
    });
  }
  if (current.error) throw new Error(`Operation failed: ${JSON.stringify(current.error)}`);
}

async function waitRegionOp(op, timeoutMs = 300_000) {
  const start = Date.now();
  let current = op;
  while (current.status !== 'DONE') {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Region operation ${current.name} timed out`);
    }
    await sleep(5000);
    [current] = await regionOpsClient.get({
      project: PROJECT_ID,
      operation: current.name,
      region: current.region?.split('/').pop() || '',
    });
  }
  if (current.error) throw new Error(`Operation failed: ${JSON.stringify(current.error)}`);
}

async function markSucceeded(rec) {
  try {
    await recommenderClient.markRecommendationState({
      name: rec.name,
      state: 'SUCCEEDED',
    });
  } catch (e) {
    console.warn(`Could not mark recommendation ${rec.name}: ${e.message}`);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
