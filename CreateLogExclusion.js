// log-exclusion.js
const { Logging } = require('@google-cloud/logging');

const logging = new Logging();

/**
 * Create a project-level exclusion on the _Default sink.
 * Excludes load-balancer health-check logs and low-severity GCS events.
 */
async function createExclusions(projectId) {
  const exclusions = [
    {
      name: 'exclude-health-checks',
      description: 'Exclude LB health check logs',
      filter: 'resource.type="http_load_balancer" AND (httpRequest.requestUrl="/health" OR httpRequest.requestUrl="/healthz" OR httpRequest.requestUrl="/ready")',
    },
    {
      name: 'exclude-gcs-low-severity',
      description: 'Exclude low-severity GCS bucket events (sample 99%)',
      filter: 'resource.type="gcs_bucket" AND severity<ERROR AND sample(insertId, 0.99)',
    },
    {
      name: 'exclude-data-access-audit',
      description: 'Exclude Data Access audit logs (noisy, rarely needed)',
      filter: 'log_id("cloudaudit.googleapis.com/data_access")',
    },
  ];

  for (const ex of exclusions) {
    const [created] = await logging.project(projectId).createExclusion(ex);
    console.log(`Created exclusion: ${created.name}`);
  }
}

createExclusions(process.env.PROJECT_ID).catch(console.error);   
