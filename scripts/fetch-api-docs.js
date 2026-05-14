/**
 * 批量获取七牛云 API 文档
 * 
 * 使用方法:
 * node scripts/fetch-api-docs.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// 需要获取的 API 接口列表
const apis = [
  { id: '1308', name: 'stat', title: '资源元信息查询' },
  { id: '1252', name: 'chgm', title: '资源元信息修改' },
  { id: '1288', name: 'move', title: '资源移动/重命名' },
  { id: '1254', name: 'copy', title: '资源复制' },
  { id: '1257', name: 'delete', title: '资源删除' },
  { id: '1250', name: 'batch', title: '批量操作' },
  { id: '1312', name: 'upload', title: '直传文件' },
  { id: '6365', name: 'initiateMultipartUpload', title: '初始化分片上传任务' },
  { id: '6366', name: 'uploadPart', title: '分块上传数据' },
  { id: '6368', name: 'completeMultipartUpload', title: '完成文件上传' },
  { id: '3710', name: 'chtype', title: '修改文件存储类型' },
  { id: '4173', name: 'chstatus', title: '修改文件状态' },
];

const outputDir = path.join(__dirname, '..', 'docs', 'qiniu-api');

// 确保输出目录存在
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

function fetchApiDoc(api) {
  return new Promise((resolve, reject) => {
    const url = `https://developer.qiniu.com/kodo/${api.id}/${api.name}`;
    
    https.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        console.log(`✓ 获取 ${api.title} (${api.name}) 文档成功`);
        resolve({ api, html: data });
      });
    }).on('error', (err) => {
      console.error(`✗ 获取 ${api.title} (${api.name}) 文档失败:`, err.message);
      reject(err);
    });
  });
}

async function main() {
  console.log('开始获取 API 文档...\n');
  
  for (const api of apis) {
    try {
      const { html } = await fetchApiDoc(api);
      
      // 这里可以解析 HTML 并转换为 Markdown
      // 由于解析 HTML 比较复杂，这里只是保存原始 HTML
      const outputPath = path.join(outputDir, `${api.name}.html`);
      fs.writeFileSync(outputPath, html, 'utf8');
      
      console.log(`  保存到: ${outputPath}\n`);
      
      // 避免请求过快
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`处理 ${api.name} 时出错:`, error.message);
    }
  }
  
  console.log('\n所有文档获取完成！');
  console.log(`\n提示: HTML 文件已保存到 ${outputDir}`);
  console.log('你可以手动将它们转换为 Markdown 格式');
}

main().catch(console.error);
