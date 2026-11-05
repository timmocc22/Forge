import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const packages = [];
for (const group of ['apps', 'packages']) {
  for (const item of await readdir(resolve(root, group))) {
    const path = resolve(root, group, item);
    const manifest = JSON.parse(await readFile(resolve(path, 'package.json'), 'utf8'));
    packages.push({ path, manifest, group });
  }
}
const allowed = {
  '@studio/ui': [],
  '@studio/contracts': [],
  '@studio/plugin-sdk': [],
  '@studio/api': ['@studio/contracts'],
  '@studio/web': ['@studio/contracts', '@studio/plugin-sdk', '@studio/ui'],
};
const violations = [];
async function walk(path) {
  const result = [];
  for (const item of await readdir(path, { withFileTypes: true })) {
    const full = resolve(path, item.name);
    if (item.isDirectory()) result.push(...(await walk(full)));
    else if (/\.(ts|vue)$/.test(item.name) && !item.name.endsWith('.spec.ts')) result.push(full);
  }
  return result;
}
for (const pkg of packages) {
  for (const file of await walk(resolve(pkg.path, 'src'))) {
    const raw = await readFile(file, 'utf8');
    const content = file.endsWith('.vue')
      ? (raw.match(/<script[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? '')
      : raw;
    const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
    const imports = [];
    function visit(node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        imports.push(node.moduleSpecifier.text);
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        imports.push(node.arguments[0].text);
      ts.forEachChild(node, visit);
    }
    visit(source);
    for (const specifier of imports) {
      const message = (reason) =>
        violations.push(`${relative(root, file)} → ${specifier}: ${reason}`);
      if (specifier.startsWith('.')) {
        const target = resolve(dirname(file), specifier);
        if (!target.startsWith(`${pkg.path}/`)) message('跨包必须使用公开包入口');
        if (pkg.manifest.name === '@studio/api') {
          const sourcePath = relative(resolve(pkg.path, 'src'), file);
          const targetPath = relative(resolve(pkg.path, 'src'), target);
          if (sourcePath.startsWith('generation/') && targetPath.startsWith('projects/'))
            message('模型生成模块不得依赖项目业务');
          if (
            sourcePath.startsWith('projects/') &&
            targetPath.startsWith('generation/') &&
            targetPath !== 'generation/ports.js' &&
            !(
              sourcePath === 'projects/projects.module.ts' &&
              targetPath === 'generation/generation.module.js'
            )
          )
            message('项目模块只能通过模型端口调用生成能力，由模块入口装配依赖');
        }
      }
      if (specifier.startsWith('@studio/')) {
        const dependency = specifier.split('/').slice(0, 2).join('/');
        if (specifier !== dependency) message('禁止深层导入内部实现');
        if (!pkg.manifest.dependencies?.[dependency]) message('必须显式声明 workspace 依赖');
        const list = allowed[pkg.manifest.name];
        if (list && !list.includes(dependency)) message('违反层级依赖方向');
      }
      if (pkg.group !== 'apps' && (specifier.startsWith('@nestjs/') || specifier === 'pinia'))
        message('共享包不得依赖应用框架状态');
      if (file.includes('/application/') || file.includes('/domain/')) {
        if (/^(vue|pinia|@nestjs|node:)/.test(specifier) || specifier.includes('/infrastructure/'))
          message('领域和应用层只依赖端口，不得依赖框架或基础设施');
      }
      if (pkg.group !== 'apps' && specifier.startsWith('node:')) message('共享包应保持环境无关');
    }
  }
}
if (violations.length) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else console.log(`Architecture boundaries passed (${packages.length} workspaces).`);
