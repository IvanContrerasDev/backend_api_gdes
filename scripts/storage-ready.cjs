// Authenticated readiness: the configured private bucket must actually be usable.
const { S3Client, HeadBucketCommand } = require('@aws-sdk/client-s3');
const client = new S3Client({
  endpoint: process.env.STORAGE_ENDPOINT,
  region: process.env.STORAGE_REGION,
  credentials: {
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID,
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
  maxAttempts: 1,
});
(async () => {
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        await client.send(new HeadBucketCommand({ Bucket: process.env.STORAGE_BUCKET }), {
          abortSignal: AbortSignal.timeout(2000),
        });
        console.log('Private storage bucket ready (authenticated)');
        return;
      } catch {
        if (attempt === 59) throw Error('Storage bucket did not become ready');
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  } finally {
    client.destroy();
  }
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
