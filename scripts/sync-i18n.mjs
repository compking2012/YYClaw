import { readFileSync, writeFileSync } from 'fs';

// 读取 i18n 配置
const enCommon = JSON.parse(readFileSync('./shared/i18n/locales/en/common.json', 'utf-8'));
const productName = enCommon.appName;
const copyright = enCommon.copyright;

// 同步 package.json
const pkgPath = './package.json';
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
if (pkg.productName !== productName) {
    pkg.productName = productName;
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 4) + '\n');
}

// 同步 electron-builder.yml
const builderPath = './electron-builder.yml';
let builderYml = readFileSync(builderPath, 'utf-8');
builderYml = builderYml.replace(/^productName:.*$/m, `productName: ${productName}`);
builderYml = builderYml.replace(/^copyright:.*$/m, `copyright: ${copyright}`);
writeFileSync(builderPath, builderYml);

// 同步 index.html
const htmlPath = './index.html';
let html = readFileSync(htmlPath, 'utf-8');
html = html.replace(/<title>.*?<\/title>/, `<title>${productName}</title>`);
writeFileSync(htmlPath, html);
