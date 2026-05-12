#!/usr/bin/env node

/**
 * 发布脚本 - 自动更新版本号并创建 git tag
 * 
 * 使用方法：
 *   node scripts/release.js <version>
 * 
 * 示例：
 *   node scripts/release.js 0.2.0
 *   node scripts/release.js 0.1.1
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 获取命令行参数
const newVersion = process.argv[2];

if (!newVersion) {
  console.error('❌ 错误：请提供版本号');
  console.log('使用方法: node scripts/release.js <version>');
  console.log('示例: node scripts/release.js 0.2.0');
  process.exit(1);
}

// 验证版本号格式
if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error('❌ 错误：版本号格式不正确，应为 x.y.z 格式');
  console.log('示例: 0.1.0, 1.2.3');
  process.exit(1);
}

console.log(`\n🚀 开始发布流程 v${newVersion}\n`);

// 1. 更新 package.json
console.log('📝 更新 package.json...');
const packageJsonPath = path.join(__dirname, '../package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
packageJson.version = newVersion;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + '\n');
console.log('✅ package.json 已更新');

// 2. 更新 Cargo.toml
console.log('📝 更新 Cargo.toml...');
const cargoTomlPath = path.join(__dirname, '../src-tauri/Cargo.toml');
let cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
cargoToml = cargoToml.replace(/^version = ".*"$/m, `version = "${newVersion}"`);
fs.writeFileSync(cargoTomlPath, cargoToml);
console.log('✅ Cargo.toml 已更新');

// 3. 更新 tauri.conf.json
console.log('📝 更新 tauri.conf.json...');
const tauriConfPath = path.join(__dirname, '../src-tauri/tauri.conf.json');
const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
tauriConf.version = newVersion;
fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');
console.log('✅ tauri.conf.json 已更新');

// 4. Git 操作
console.log('\n📦 提交更改...');
try {
  execSync('git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json', { stdio: 'inherit' });
  execSync(`git commit -m "chore: bump version to ${newVersion}"`, { stdio: 'inherit' });
  console.log('✅ 更改已提交');

  console.log('\n🏷️  创建 git tag...');
  execSync(`git tag v${newVersion}`, { stdio: 'inherit' });
  console.log(`✅ Tag v${newVersion} 已创建`);

  console.log('\n📤 推送到远程仓库...');
  console.log('执行命令: git push');
  execSync('git push', { stdio: 'inherit' });
  console.log('执行命令: git push origin v' + newVersion);
  execSync(`git push origin v${newVersion}`, { stdio: 'inherit' });
  console.log('✅ 已推送到远程仓库');

  console.log('\n✨ 发布流程完成！');
  console.log('\n📋 后续步骤：');
  console.log('1. GitHub Actions 将自动构建所有平台的安装包');
  console.log('2. 访问 GitHub Releases 页面查看构建进度');
  console.log('3. 构建完成后，编辑 Release 说明并发布');
  console.log(`\n🔗 Release 页面: https://github.com/YOUR_USERNAME/qiniu-browser/releases/tag/v${newVersion}`);

} catch (error) {
  console.error('\n❌ Git 操作失败:', error.message);
  console.log('\n💡 提示：你可以手动执行以下命令：');
  console.log(`   git add .`);
  console.log(`   git commit -m "chore: bump version to ${newVersion}"`);
  console.log(`   git tag v${newVersion}`);
  console.log(`   git push`);
  console.log(`   git push origin v${newVersion}`);
  process.exit(1);
}
