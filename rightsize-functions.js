// rightsize-functions.js
const { CloudFunctions } = require('@google-cloud/functions');
const { Metric } = require('@google-cloud/monitoring');

const functions = new CloudFunctions();
const monitoring = new Metric();
const PROJECT_ID = process.env.PROJECT_ID;
const REGION = process.env.REGION || 'us-central1';

const MEMORY_TIERS = [128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768]; // MiB

/**
 * For each function, find peak memory over the last 7 days
 * and suggest the next-smallest tier that still has headroom.
 */
async function rightsizeFunctions() {
  const [response] = await functions.listFunctions({
    parent: `projects/${PROJECT_ID}/locations/${REGION}`,
  });

  for (const fn of response.functions || []) {
    const currentMem = parseInt(fn.serviceConfig?.availableMemory || '256M', 10);
    const currentTimeout = fn.serviceConfig?.timeoutSeconds || 60;

    // Query peak memory usage (last 7 days)
    const peakMem = await getPeakMemory(fn.name);
    if (peakMem === null) {
      console.log(`${fn.name}: no monitoring data, skipping`);
      continue;
    }

    // Target: 1.5× headroom above observed peak
    const targetMem = Math.ceil(peakMem * 1.5 / 128) * 128;
    const rightSized = MEMORY_TIERS.find(t => t >= targetMem) || currentMem;

    if (rightSized < currentMem) {
      console.log(`↓ ${fn.name}: ${currentMem}MB → ${rightSized}MB (peak: ${Math.round(peakMem)}MB)`);
      if (process.env.APPLY === 'true') {
        await applyConfig(fn, rightSized, currentTimeout);
      }
    } else {
      console.log(`✓ ${fn.name}: ${currentMem}MB is appropriate (peak: ${Math.round(peakMem)}MB)`);
    }
  }
}

async function getPeakMemory(functionName) {
  try {
    const [result] = await monitoring.listTimeSeries({
      name: `projects/${PROJECT_ID}`,
      filter: `resource.labels.function_name="${functionName.split('/').pop()}" AND metric.type="cloudfunctions/backend_memory_usage"`,
      interval: { startTime: sevenDaysAgo(), endTime: new Date().toISOString() },
      aggregation: { alignmentMethod: 'ALIGN_MAX', perSeriesAligner: 'ALIGN_MAX' },
    });
    const points = result.timeSeries?.[0]?.points || [];
    if (!points.length) return null;
    return Math.max(...points.map(p => p.value?.int64Value || p.value?.doubleValue || 0)) / (1024 * 1024); // → MiB
  } catch (e) {
    console.warn(`Monitoring query failed for ${functionName}: ${e.message}`);
    return null;
  }
}

async function applyConfig(fn, newMemMiB, timeout) {
  const [updated] = await functions.patchFunction({
    name: fn.name,
    serviceConfig: {
      availableMemory: `${newMemMiB}M`,
      timeoutSeconds: timeout,
    },
  }, { updateMask: 'serviceConfig.availableMemory' });
  console.log(`  Deployed ${newMemMiB}MB to ${fn.name}`);
}

function sevenDaysAgo() {
  return new Date(Date.now() - 7 * 86400_000).toISOString();
}

rightsizeFunctions().catch(console.error);   
