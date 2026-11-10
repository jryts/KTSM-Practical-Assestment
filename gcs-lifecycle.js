// gcs-lifecycle.js
const { Storage } = require('@google-cloud/storage');

const storage = new Storage();

/**
 * Apply lifecycle rules to a bucket:
 *  - Age > 30 days  → NEARLINE
 *  - Age > 90 days  → COLDLINE
 *  - Age > 365 days → ARCHIVE
 *  - Non-current versions > 7 days → DELETE
 */
async function applyLifecycleRules(bucketName) {
  const [bucket] = await storage.bucket(bucketName);

  const [metadata] = await bucket.setMetadata({
    lifecycle: {
      rule: [
        {
          action: { type: 'SetStorageClass', storageClass: 'NEARLINE' },
          condition: { age: 30, matchesStorageClass: ['STANDARD'] },
        },
        {
          action: { type: 'SetStorageClass', storageClass: 'COLDLINE' },
          condition: { age: 90, matchesStorageClass: ['NEARLINE'] },
        },
        {
          action: { type: 'SetStorageClass', storageClass: 'ARCHIVE' },
          condition: { age: 365, matchesStorageClass: ['COLDLINE'] },
        },
        {
          action: { type: 'Delete' },
          condition: { isLive: false, numNewerVersions: 2 },
        },
        {
          action: { type: 'AbortIncompleteMultipartUpload' },
          condition: { age: 7 },
        },
      ],
    },
  });

  console.log(`Lifecycle rules applied to ${bucketName}:`);
  console.log(JSON.stringify(metadata.lifecycle, null, 2));
}

applyLifecycleRules(process.env.BUCKET_NAME).catch(console.error);   
