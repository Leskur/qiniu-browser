const fs = require('fs');
let content = fs.readFileSync('c:/Projects/Leskur/qiniu-browser/src/lib/qiniu.ts', 'utf8');

// remove the bad bytes at the end
content = content.replace(/\/\/ \ufffd+ CDN API [\ufffd\s\n]+/g, '');

const newCode = `
export async function batchOperations(ak: string, sk: string, ops: string[]): Promise<any> {
  if (ops.length === 0) return [];
  const host = "rs.qiniuapi.com";
  const path = "/batch";
  const url = \`https://\${host}\${path}\`;
  const body = ops.map(op => \`op=\${op}\`).join("&");
  const token = generateQiniuToken(ak, sk, "POST", path, host, "application/x-www-form-urlencoded", body);
  const response = await tauriFetch(url, {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body
  });
  if (!response.ok && response.status !== 298) {
    const errText = await response.text();
    throw new Error(\`Batch failed: \${response.status} \${errText}\`);
  }
  return await response.json();
}

export async function batchDeleteFiles(ak: string, sk: string, bucket: string, keys: string[]): Promise<void> {
  const chunks = [];
  for (let i = 0; i < keys.length; i += 1000) {
    chunks.push(keys.slice(i, i + 1000));
  }
  for (const chunk of chunks) {
    const ops = chunk.map(key => {
      const encodedEntryURI = btoa(unescape(encodeURIComponent(\`\${bucket}:\${key}\`))).replace(/\\+/g, "-").replace(/\\//g, "_");
      return \`/delete/\${encodedEntryURI}\`;
    });
    await batchOperations(ak, sk, ops);
  }
}

export async function deleteDirectory(ak: string, sk: string, bucket: string, prefix: string): Promise<void> {
  let marker = "";
  while (true) {
    const res = await fetchFiles(ak, sk, bucket, prefix, marker, 1000);
    if (res.items && res.items.length > 0) {
      const keys = res.items.map((i: any) => i.key);
      await batchDeleteFiles(ak, sk, bucket, keys);
    }
    if (!res.marker) break;
    marker = res.marker;
  }
}

export async function forceDeleteBucket(ak: string, sk: string, bucket: string): Promise<void> {
  await deleteDirectory(ak, sk, bucket, "");
  await deleteBucket(ak, sk, bucket);
}
`;

fs.writeFileSync('c:/Projects/Leskur/qiniu-browser/src/lib/qiniu.ts', content + newCode, 'utf8');
